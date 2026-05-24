"""Smoke tests for `.github/scripts/render-eval-comment.py`.

The renderer is stdlib-only, lives outside the indexer package, and runs
in CI before the indexer's full test suite. These tests just import its
`render` function and feed it representative summary dicts so we catch
shape drift if RunSummary's JSON serialization changes.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

import pytest

_RENDERER_PATH = (
    Path(__file__).resolve().parent.parent.parent.parent
    / ".github"
    / "scripts"
    / "render-eval-comment.py"
)


@pytest.fixture(scope="module")
def render():
    """Load `render` from `.github/scripts/render-eval-comment.py`.

    The script has a hyphen in the filename (CI tooling convention),
    so we go through importlib rather than a `from` import.
    """
    assert _RENDERER_PATH.is_file(), f"renderer not found: {_RENDERER_PATH}"
    spec = importlib.util.spec_from_file_location("render_eval_comment", _RENDERER_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["render_eval_comment"] = module
    spec.loader.exec_module(module)
    return module.render


def _summary(**overrides: Any) -> dict:
    base: dict[str, Any] = {
        "run_id": "ci-12345-v1",
        "created_at": "2026-05-24T16:00:00Z",
        "agent_version": "abc1234",
        "prompt_version": "v0.2",
        "judge_version": "v1",
        "judge_model": "claude-sonnet-4-5",
        "dataset_version": "v1",
        "example_count": 5,
        "judge_score": 0.812,
        "deterministic_score": 0.74,
        "false_positive_rate": 0.2,
        "trap_rate": 0.0,
        "p50_latency_ms": 8400,
        "p95_latency_ms": 15200,
        "mean_cost_per_review_usd": 0.0421,
        "total_cost_usd": 0.2103,
        "failed_judge_count": 0,
        "by_difficulty": {
            "easy": {
                "count": 2,
                "judge_score": 0.95,
                "deterministic_score": 0.9,
                "false_positive_rate": 0.0,
                "trap_rate": 0.0,
            },
            "medium": {
                "count": 2,
                "judge_score": 0.8,
                "deterministic_score": 0.75,
                "false_positive_rate": 0.25,
                "trap_rate": 0.0,
            },
            "hard": {
                "count": 1,
                "judge_score": 0.6,
                "deterministic_score": 0.5,
                "false_positive_rate": 0.4,
                "trap_rate": 0.0,
            },
        },
        "delta": None,
        "verdict": "pass",
    }
    base.update(overrides)
    return base


class TestRender:
    def test_pass_verdict_uses_checkmark(self, render) -> None:
        out = render(_summary(verdict="pass"))
        assert "✅" in out
        assert "❌" not in out

    def test_below_bar_uses_cross(self, render) -> None:
        out = render(_summary(verdict="below-bar"))
        assert "❌" in out
        assert "✅" not in out

    def test_includes_run_id_and_dataset(self, render) -> None:
        out = render(_summary(run_id="ci-99-v1"))
        assert "ci-99-v1" in out
        assert "v1" in out

    def test_renders_top_level_metrics_table(self, render) -> None:
        out = render(_summary())
        # Header row + at least one metric row each
        assert "| Metric | Value |" in out
        assert "Judge score" in out
        assert "Mean cost / review" in out
        # Numeric formatting
        assert "0.812" in out  # judge_score
        assert "$0.0421" in out  # mean_cost_per_review_usd

    def test_renders_by_difficulty_in_stable_order(self, render) -> None:
        out = render(_summary())
        easy_idx = out.find("| easy |")
        medium_idx = out.find("| medium |")
        hard_idx = out.find("| hard |")
        assert 0 < easy_idx < medium_idx < hard_idx

    def test_omits_difficulty_table_when_absent(self, render) -> None:
        out = render(_summary(by_difficulty={}))
        assert "By difficulty" not in out

    def test_renders_delta_block_when_present(self, render) -> None:
        out = render(_summary(delta={"judge_score": 0.04, "p95_latency_ms": -1200}))
        assert "Δ vs prior run" in out
        assert "📈" in out  # judge_score went up
        assert "📉" in out  # latency went down
        assert "+0.0400" in out
        assert "-1200.0000" in out

    def test_omits_delta_block_when_absent(self, render) -> None:
        out = render(_summary(delta=None))
        assert "Δ vs prior run" not in out

    def test_handles_null_judge_score_in_breakdown(self, render) -> None:
        bd = _summary()["by_difficulty"]["easy"].copy()
        bd["judge_score"] = None
        out = render(
            _summary(
                by_difficulty={"easy": bd},
            )
        )
        # Should print "n/a" instead of crashing on None formatting
        assert "n/a" in out
