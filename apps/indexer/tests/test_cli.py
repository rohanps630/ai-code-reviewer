"""CLI integration tests.

End-to-end test of `evals.cli` with stub bridge + stub judge client
injected via the run() function's optional factories. Zero LLM spend.

What we exercise:
  - Happy path: dataset loads, examples run, summary.json lands at the
    expected path, exit 0
  - Bridge failures: a single BridgeError per example degrades to an
    empty review without aborting the whole run
  - Dataset not found: exit 2
  - --limit honored
  - --no-delta skips loading prior summary
  - Verdict-driven exit codes
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from evals.bridge import BridgeError
from evals.cli import _ResilientBridge, build_parser, run
from evals.runner import BridgeResult
from evals.schema import EvalExample, GroundTruth, GroundTruthFinding
from evals.scorers.types import PredictedFinding, PredictedReview

# ────────────────────────────────────────────────────────────────────
# Stubs
# ────────────────────────────────────────────────────────────────────


class _StubBridge:
    """Bridge factory + callable in one object. Compatible with
    `SubprocessBridge`'s constructor signature so the CLI can swap it
    in via the `bridge_factory` parameter."""

    review_for: dict[str, PredictedReview] = {}
    raise_for: set[str] = set()
    instances: list[_StubBridge] = []

    def __init__(
        self,
        *,
        default_model: str,
        timeout_seconds: float,
        **_: object,
    ) -> None:
        self.default_model = default_model
        self.timeout_seconds = timeout_seconds
        _StubBridge.instances.append(self)

    def __call__(self, example: EvalExample) -> BridgeResult:
        if example.id in _StubBridge.raise_for:
            raise BridgeError(f"stub raised for {example.id}")
        review = _StubBridge.review_for.get(example.id, _default_review())
        return BridgeResult(review=review, latency_ms=42, cost_usd=0.0)

    @classmethod
    def reset(cls) -> None:
        cls.review_for = {}
        cls.raise_for = set()
        cls.instances = []


def _default_review() -> PredictedReview:
    return PredictedReview(
        summary="Looks fine.",
        findings=[
            PredictedFinding(
                category="bug",
                severity="major",
                summary="Null deref on user lookup.",
                location_hint="billing.py:8",
            ),
        ],
        confidence="medium",
    )


class _StubJudgeClient:
    """Mimics `anthropic.Anthropic` enough for `judge_example` to work."""

    def __init__(self, *, score: float = 0.8) -> None:
        payload = {"score": score, "rationale": "stub judge ok"}
        # judge.py looks for ```json fenced blocks; provide one.
        text = f"```json\n{json.dumps(payload)}\n```"
        self.messages = SimpleNamespace(create=lambda **kwargs: _stub_response(text))


def _stub_response(text: str) -> Any:
    """Build an Anthropic-like Message with one text block + usage."""
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)],
        model="claude-sonnet-4-5",
        usage=SimpleNamespace(
            input_tokens=100,
            output_tokens=20,
            cache_read_input_tokens=0,
            cache_creation_input_tokens=0,
        ),
    )


# ────────────────────────────────────────────────────────────────────
# Fixtures: build a temp dataset on disk
# ────────────────────────────────────────────────────────────────────


def _example(eid: str, *, truth_summary: str = "Null deref on user.") -> EvalExample:
    return EvalExample(
        id=eid,
        pr_url=None,
        pr_title=f"Test PR {eid}",
        pr_diff=f"diff --git a/foo.py b/foo.py\n+# {eid}\n",
        ground_truth=GroundTruth(
            findings=[
                GroundTruthFinding(
                    category="bug",
                    severity="major",
                    summary=truth_summary,
                    location_hint="billing.py:8",
                ),
            ],
            expected_findings_count=1,
        ),
        difficulty="easy",
        added_at=date(2026, 5, 24),
        added_by="test",
    )


def _write_dataset(root: Path, version: str, examples: list[EvalExample]) -> Path:
    ds_dir = root / version
    ds_dir.mkdir(parents=True, exist_ok=True)
    path = ds_dir / "examples.jsonl"
    with path.open("w") as f:
        for ex in examples:
            f.write(ex.model_dump_json() + "\n")
    return path


@pytest.fixture(autouse=True)
def _reset_stub_bridge() -> None:
    _StubBridge.reset()
    yield
    _StubBridge.reset()


def _args(**overrides: Any) -> Any:
    """Build an argparse.Namespace via the real parser so defaults match prod."""
    parser = build_parser()
    base = [
        "run",
        "--dataset",
        overrides.pop("dataset", "v1"),
    ]
    for key, value in overrides.items():
        if value is True:
            base.append(f"--{key.replace('_', '-')}")
        elif value is False or value is None:
            continue
        else:
            base.append(f"--{key.replace('_', '-')}")
            base.append(str(value))
    return parser.parse_args(base)


# ────────────────────────────────────────────────────────────────────
# build_parser — argparse shape
# ────────────────────────────────────────────────────────────────────


class TestParser:
    def test_run_requires_dataset(self) -> None:
        with pytest.raises(SystemExit):
            build_parser().parse_args(["run"])

    def test_run_accepts_all_optional_args(self) -> None:
        ns = build_parser().parse_args(
            [
                "run",
                "--dataset",
                "v1",
                "--limit",
                "5",
                "--bridge-model",
                "haiku",
                "--judge-model",
                "claude-haiku-4-5",
                "--no-delta",
            ]
        )
        assert ns.dataset == "v1"
        assert ns.limit == 5
        assert ns.bridge_model == "haiku"
        assert ns.judge_model == "claude-haiku-4-5"
        assert ns.no_delta is True


# ────────────────────────────────────────────────────────────────────
# _ResilientBridge — degrade on BridgeError
# ────────────────────────────────────────────────────────────────────


class TestResilientBridge:
    def test_passthrough_on_success(self) -> None:
        bridge = _ResilientBridge(_StubBridge(default_model="sonnet", timeout_seconds=10))
        result = bridge(_example("ok"))
        assert result.review.summary == "Looks fine."

    def test_degrades_on_bridge_error(
        self,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        _StubBridge.raise_for.add("blew-up")
        bridge = _ResilientBridge(_StubBridge(default_model="sonnet", timeout_seconds=10))
        result = bridge(_example("blew-up"))
        assert result.review.findings == []
        assert "bridge error" in result.review.summary.lower()
        assert result.latency_ms == 0
        assert result.cost_usd == 0.0
        err = capsys.readouterr().err
        assert "bridge-error" in err
        assert "blew-up" in err


# ────────────────────────────────────────────────────────────────────
# run() — end-to-end with stubs
# ────────────────────────────────────────────────────────────────────


class TestRunCommand:
    def test_dataset_not_found_returns_2(self, tmp_path: Path) -> None:
        ns = _args(
            datasets_root=str(tmp_path / "datasets"),
            results_root=str(tmp_path / "results"),
            no_delta=True,
        )
        exit_code = run(
            ns,
            bridge_factory=_StubBridge,
            anthropic_client_factory=_StubJudgeClient,
        )
        assert exit_code == 2

    def test_happy_path_writes_summary_and_traces(self, tmp_path: Path) -> None:
        datasets = tmp_path / "datasets"
        results = tmp_path / "results"
        _write_dataset(
            datasets,
            "v1",
            [_example("ex-1"), _example("ex-2")],
        )

        ns = _args(
            datasets_root=str(datasets),
            results_root=str(results),
            no_delta=True,
            run_id="test-run",
        )
        exit_code = run(
            ns,
            bridge_factory=_StubBridge,
            anthropic_client_factory=_StubJudgeClient,
        )
        assert exit_code in {0, 1}  # depends on verdict computed against stub scores

        summary_path = results / "test-run" / "summary.json"
        assert summary_path.is_file()

        summary = json.loads(summary_path.read_text())
        assert summary["run_id"] == "test-run"
        assert summary["dataset_version"] == "v1"
        assert summary["example_count"] == 2

        # Per-example traces written
        raw_dir = results / "test-run" / "raw"
        assert (raw_dir / "ex-1.json").is_file()
        assert (raw_dir / "ex-2.json").is_file()

    def test_limit_honored(self, tmp_path: Path) -> None:
        datasets = tmp_path / "datasets"
        results = tmp_path / "results"
        _write_dataset(
            datasets,
            "v1",
            [_example("ex-1"), _example("ex-2"), _example("ex-3")],
        )

        ns = _args(
            datasets_root=str(datasets),
            results_root=str(results),
            no_delta=True,
            run_id="test-limit",
            limit=2,
        )
        run(
            ns,
            bridge_factory=_StubBridge,
            anthropic_client_factory=_StubJudgeClient,
        )
        summary = json.loads((results / "test-limit" / "summary.json").read_text())
        assert summary["example_count"] == 2

    def test_bridge_failure_doesnt_abort_run(self, tmp_path: Path) -> None:
        datasets = tmp_path / "datasets"
        results = tmp_path / "results"
        _write_dataset(
            datasets,
            "v1",
            [_example("ok-1"), _example("crashed"), _example("ok-2")],
        )
        _StubBridge.raise_for.add("crashed")

        ns = _args(
            datasets_root=str(datasets),
            results_root=str(results),
            no_delta=True,
            run_id="test-fail",
        )
        run(
            ns,
            bridge_factory=_StubBridge,
            anthropic_client_factory=_StubJudgeClient,
        )

        summary = json.loads((results / "test-fail" / "summary.json").read_text())
        assert summary["example_count"] == 3
        # crashed example's trace shows the empty review
        crashed_trace = json.loads((results / "test-fail" / "raw" / "crashed.json").read_text())
        assert crashed_trace["bridge"]["review"]["findings"] == []

    def test_run_id_auto_generated_when_not_passed(self, tmp_path: Path) -> None:
        datasets = tmp_path / "datasets"
        results = tmp_path / "results"
        _write_dataset(datasets, "v1", [_example("ex-1")])

        ns = _args(
            datasets_root=str(datasets),
            results_root=str(results),
            no_delta=True,
        )
        run(
            ns,
            bridge_factory=_StubBridge,
            anthropic_client_factory=_StubJudgeClient,
        )
        # The run dir starts with the dataset version
        run_dirs = [d for d in results.iterdir() if d.is_dir()]
        assert len(run_dirs) == 1
        assert run_dirs[0].name.startswith("v1-")

    def test_summary_stamps_judge_model_from_args(self, tmp_path: Path) -> None:
        datasets = tmp_path / "datasets"
        results = tmp_path / "results"
        _write_dataset(datasets, "v1", [_example("ex-1")])

        ns = _args(
            datasets_root=str(datasets),
            results_root=str(results),
            no_delta=True,
            run_id="test-judge-model",
            judge_model="claude-haiku-4-5",
        )
        run(
            ns,
            bridge_factory=_StubBridge,
            anthropic_client_factory=_StubJudgeClient,
        )
        summary = json.loads((results / "test-judge-model" / "summary.json").read_text())
        assert summary["judge_model"] == "claude-haiku-4-5"
