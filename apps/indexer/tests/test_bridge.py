"""SubprocessBridge tests.

Drives the real `subprocess.run` against `tests/fixtures/bridge/mock-bridge.mjs`
so the wire protocol + stdin/stdout glue is exercised end-to-end. We never
touch @acr/agent here — the fixture script switches behavior based on
markers embedded in the example's diff.

Skipped automatically if `node` isn't on PATH; CI guarantees it.
"""

from __future__ import annotations

import shutil
from datetime import date
from pathlib import Path

import pytest

from evals.bridge import BridgeError, SubprocessBridge
from evals.schema import EvalExample, GroundTruth, GroundTruthFinding

FIXTURE_BRIDGE = Path(__file__).resolve().parent / "fixtures" / "bridge" / "mock-bridge.mjs"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None,
    reason="node not on PATH; bridge tests require a Node runtime",
)


def _example(diff: str, eid: str = "test-example") -> EvalExample:
    return EvalExample(
        id=eid,
        pr_url=None,
        pr_title="Test PR",
        pr_diff=diff,
        ground_truth=GroundTruth(
            findings=[
                GroundTruthFinding(
                    category="bug",
                    severity="minor",
                    summary="placeholder",
                )
            ],
            expected_findings_count=1,
        ),
        difficulty="easy",
        added_at=date(2026, 5, 24),
        added_by="test",
    )


# ────────────────────────────────────────────────────────────────────
# Happy path
# ────────────────────────────────────────────────────────────────────


class TestHappyPath:
    def test_returns_bridge_result_with_review_and_latency(self) -> None:
        bridge = SubprocessBridge(script_path=FIXTURE_BRIDGE)
        result = bridge(_example("any diff"))
        assert result.review.summary == "Test review"
        assert result.review.confidence == "low"
        assert result.review.findings[0].category == "bug"
        assert result.latency_ms >= 0
        assert result.cost_usd == 0.0

    def test_default_model_is_sonnet(self) -> None:
        bridge = SubprocessBridge(script_path=FIXTURE_BRIDGE)
        result = bridge(_example("__MOCK_ECHO_MODEL__"))
        assert "sonnet" in result.review.summary

    def test_default_model_can_be_overridden(self) -> None:
        bridge = SubprocessBridge(script_path=FIXTURE_BRIDGE, default_model="haiku")
        result = bridge(_example("__MOCK_ECHO_MODEL__"))
        assert "haiku" in result.review.summary


# ────────────────────────────────────────────────────────────────────
# Soft failures (CLI exits 0 with { ok: false })
# ────────────────────────────────────────────────────────────────────


class TestSoftFailures:
    def test_ok_false_envelope_raises_bridge_error(self) -> None:
        bridge = SubprocessBridge(script_path=FIXTURE_BRIDGE)
        with pytest.raises(BridgeError, match="mock soft failure"):
            bridge(_example("__MOCK_SOFT_FAIL__"))


# ────────────────────────────────────────────────────────────────────
# Catastrophic failures
# ────────────────────────────────────────────────────────────────────


class TestCatastrophic:
    def test_malformed_stdout_raises(self) -> None:
        bridge = SubprocessBridge(script_path=FIXTURE_BRIDGE)
        with pytest.raises(BridgeError, match="not valid JSON"):
            bridge(_example("__MOCK_BAD_JSON__"))

    def test_empty_stdout_raises(self) -> None:
        bridge = SubprocessBridge(script_path=FIXTURE_BRIDGE)
        with pytest.raises(BridgeError, match="empty stdout"):
            bridge(_example("__MOCK_EMPTY__"))

    def test_nonzero_exit_raises_with_stderr_context(self) -> None:
        bridge = SubprocessBridge(script_path=FIXTURE_BRIDGE)
        with pytest.raises(BridgeError, match="mock crashed"):
            bridge(_example("__MOCK_NONZERO_EXIT__"))

    def test_timeout_raises(self) -> None:
        bridge = SubprocessBridge(script_path=FIXTURE_BRIDGE, timeout_seconds=0.5)
        with pytest.raises(BridgeError, match="timed out"):
            bridge(_example("__MOCK_HANG__"))


# ────────────────────────────────────────────────────────────────────
# Construction guards
# ────────────────────────────────────────────────────────────────────


class TestConstruction:
    def test_missing_script_path_rejected(self, tmp_path: Path) -> None:
        with pytest.raises(BridgeError, match="not found"):
            SubprocessBridge(script_path=tmp_path / "does-not-exist.mjs")

    def test_default_script_path_resolves(self) -> None:
        # Doesn't run the real script, just verifies the default path
        # resolves to an existing file at scripts/agent-bridge.mjs.
        bridge = SubprocessBridge()
        assert bridge is not None


# ────────────────────────────────────────────────────────────────────
# Envelope parsing edge cases — last-line fallback
# ────────────────────────────────────────────────────────────────────


class TestEnvelopeParsing:
    def test_tolerates_preceding_noise_lines(self, tmp_path: Path) -> None:
        # Build a tiny script that prints a debug line before the
        # envelope; the parser should pick up only the last line.
        noisy = tmp_path / "noisy.mjs"
        noisy.write_text(
            "process.stdout.write('debug: starting up\\n');\n"
            "process.stdout.write(JSON.stringify({"
            "ok: true, review: {summary: 's', findings: [], confidence: 'low'},"
            " latency_ms: 1, cost_usd: 0}) + '\\n');\n",
            encoding="utf-8",
        )
        bridge = SubprocessBridge(script_path=noisy)
        result = bridge(_example("ignored"))
        assert result.review.summary == "s"
        assert result.latency_ms == 1
