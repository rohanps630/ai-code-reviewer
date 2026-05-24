"""Tests for the eval runner orchestrator.

Uses in-test fakes for the agent bridge and Anthropic client so no
real tokens are spent.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from evals.runner import (
    AgentBridge,
    BridgeResult,
    ExampleTrace,
    run_eval,
)
from evals.schema import EvalExample
from evals.scorers.types import PredictedReview

# -------- fake Anthropic client (same shape as test_judge.py) --------


@dataclass
class _Block:
    text: str
    type: str = "text"


@dataclass
class _Usage:
    input_tokens: int = 1000
    output_tokens: int = 50
    cache_read_input_tokens: int = 500
    cache_creation_input_tokens: int = 0


@dataclass
class _Resp:
    content: list[_Block]
    usage: _Usage = field(default_factory=_Usage)


class _Messages:
    def __init__(self, responses: list[_Resp]) -> None:
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> _Resp:
        self.calls.append(kwargs)
        if not self._responses:
            raise RuntimeError("test forgot to enqueue a judge response")
        return self._responses.pop(0)


class _Client:
    def __init__(self, responses: list[_Resp]) -> None:
        self.messages = _Messages(responses)


# -------- examples + bridge stubs --------


def _example(eid: str, difficulty: str = "easy", truth_summary: str = "Null deref") -> EvalExample:
    return EvalExample.model_validate(
        {
            "id": eid,
            "pr_url": None,
            "pr_title": f"PR {eid}",
            "pr_diff": "diff --git a/x b/x\n",
            "ground_truth": {
                "findings": [
                    {
                        "category": "bug",
                        "severity": "major",
                        "summary": truth_summary,
                        "location_hint": "x:1",
                        "source_comment_url": None,
                    }
                ],
                "expected_findings_count": 1,
                "false_positive_traps": [],
            },
            "difficulty": difficulty,
            "added_at": "2026-05-24",
            "added_by": "rohanpsuresh",
        }
    )


def _review(
    summary: str = "Null deref on missing user",
    confidence: str = "high",
) -> PredictedReview:
    return PredictedReview.model_validate(
        {
            "summary": "Reviewer note.",
            "confidence": confidence,
            "findings": [
                {
                    "category": "bug",
                    "severity": "major",
                    "summary": summary,
                    "locationHint": "x:1",
                }
            ],
        }
    )


class _StubBridge(AgentBridge):
    def __init__(self, reviews: list[PredictedReview], latency_ms: int = 1500) -> None:
        self._reviews = list(reviews)
        self._latency = latency_ms
        self.calls: list[EvalExample] = []

    def __call__(self, example: EvalExample) -> BridgeResult:
        self.calls.append(example)
        return BridgeResult(
            review=self._reviews.pop(0),
            latency_ms=self._latency,
            cost_usd=0.012,
        )


# -------- tests --------


class TestRunEval:
    def test_happy_path(self) -> None:
        examples = [_example("e1")]
        bridge = _StubBridge([_review()])
        client = _Client([_Resp(content=[_Block(text='{"score": 0.9, "rationale": "good"}')])])

        results = run_eval(
            examples=examples,
            bridge=bridge,
            judge_client=client,
        )

        assert len(results) == 1
        r = results[0]
        assert r.example_id == "e1"
        assert r.match.found_ground_truth_bug is True
        assert r.judge_score == pytest.approx(0.9)
        assert r.judge_error is None
        assert r.latency_ms == 1500
        assert r.review_cost_usd == pytest.approx(0.012)
        # 1000 input + 50 output + 500 cache_read on sonnet-4-5
        # = 1000/1M * $3 + 50/1M * $15 + 500/1M * $0.30
        # = 0.003 + 0.00075 + 0.00015 = 0.0039
        assert r.judge_cost_usd == pytest.approx(0.00390, rel=1e-3)

    def test_judge_failure_captured_per_example(self) -> None:
        examples = [_example("e1"), _example("e2")]
        bridge = _StubBridge([_review(), _review()])
        # First judge response is malformed; second is fine.
        client = _Client(
            [
                _Resp(content=[_Block(text="not json")]),
                _Resp(content=[_Block(text='{"score": 0.5, "rationale": "ok"}')]),
            ]
        )

        results = run_eval(examples=examples, bridge=bridge, judge_client=client)

        assert len(results) == 2
        assert results[0].judge_score is None
        assert results[0].judge_error is not None
        assert "not valid JSON" in results[0].judge_error
        assert results[1].judge_score == pytest.approx(0.5)
        assert results[1].judge_error is None

    def test_writes_per_example_trace(self, tmp_path: Path) -> None:
        examples = [_example("e1")]
        bridge = _StubBridge([_review()])
        client = _Client([_Resp(content=[_Block(text='{"score": 0.7, "rationale": "x"}')])])

        run_eval(
            examples=examples,
            bridge=bridge,
            judge_client=client,
            output_dir=tmp_path,
        )

        trace_path = tmp_path / "raw" / "e1.json"
        assert trace_path.exists()
        loaded = ExampleTrace.model_validate_json(trace_path.read_text())
        assert loaded.example_id == "e1"
        assert loaded.bridge.latency_ms == 1500
        assert loaded.judge is not None
        assert loaded.judge.score == pytest.approx(0.7)
        assert loaded.match.found_ground_truth_bug is True

    def test_trace_records_judge_failure(self, tmp_path: Path) -> None:
        examples = [_example("e1")]
        bridge = _StubBridge([_review()])
        client = _Client([_Resp(content=[_Block(text="not json")])])

        run_eval(
            examples=examples,
            bridge=bridge,
            judge_client=client,
            output_dir=tmp_path,
        )

        trace = json.loads((tmp_path / "raw" / "e1.json").read_text())
        assert trace["judge"] is None
        assert "not valid JSON" in trace["judge_error"]

    def test_no_output_dir_no_trace(self, tmp_path: Path) -> None:
        bridge = _StubBridge([_review()])
        client = _Client([_Resp(content=[_Block(text='{"score": 0.9, "rationale": "x"}')])])
        run_eval(
            examples=[_example("e1")],
            bridge=bridge,
            judge_client=client,
            output_dir=None,
        )
        assert not (tmp_path / "raw").exists()

    def test_callbacks_fire_per_example(self) -> None:
        examples = [_example("e1"), _example("e2")]
        bridge = _StubBridge([_review(), _review()])
        client = _Client(
            [
                _Resp(content=[_Block(text='{"score": 0.9, "rationale": "x"}')]),
                _Resp(content=[_Block(text='{"score": 0.8, "rationale": "y"}')]),
            ]
        )
        starts: list[str] = []
        dones: list[tuple[str, float | None]] = []

        run_eval(
            examples=examples,
            bridge=bridge,
            judge_client=client,
            on_example_start=lambda ex: starts.append(ex.id),
            on_example_done=lambda ex, r: dones.append((ex.id, r.judge_score)),
        )

        assert starts == ["e1", "e2"]
        assert dones == [("e1", pytest.approx(0.9)), ("e2", pytest.approx(0.8))]

    def test_preserves_example_order(self) -> None:
        examples = [_example(f"e{i}") for i in range(5)]
        bridge = _StubBridge([_review() for _ in examples])
        client = _Client(
            [
                _Resp(content=[_Block(text=f'{{"score": 0.{i}, "rationale": "x"}}')])
                for i in range(1, 6)
            ]
        )

        results = run_eval(examples=examples, bridge=bridge, judge_client=client)
        assert [r.example_id for r in results] == [ex.id for ex in examples]

    def test_passes_custom_judge_model(self) -> None:
        examples = [_example("e1")]
        bridge = _StubBridge([_review()])
        client = _Client([_Resp(content=[_Block(text='{"score": 0.9, "rationale": "x"}')])])

        run_eval(
            examples=examples,
            bridge=bridge,
            judge_client=client,
            judge_model="claude-opus-4-7",
        )

        assert client.messages.calls[0]["model"] == "claude-opus-4-7"
