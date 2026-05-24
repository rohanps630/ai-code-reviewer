"""Tests for evals.summary."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from evals.scorers.findings import MatchedFinding, MatchResult
from evals.summary import (
    ExampleResult,
    RunSummary,
    build_summary,
    dump_summary,
    find_latest_summary,
    load_summary,
    percentile,
)


def _match(
    found: bool = True,
    fps: int = 0,
    traps: int = 0,
) -> MatchResult:
    return MatchResult(
        matches=(MatchedFinding(0, 0, 0.8),) if found else (),
        found_ground_truth_bug=found,
        false_positives=fps,
        false_positive_traps_triggered=traps,
        unmatched_truth_indices=() if found else (0,),
    )


def _result(
    example_id: str = "ex",
    difficulty: str = "easy",
    found: bool = True,
    fps: int = 0,
    traps: int = 0,
    judge_score: float | None = 0.8,
    judge_error: str | None = None,
    latency_ms: int = 1000,
    review_cost_usd: float = 0.02,
    judge_cost_usd: float = 0.005,
) -> ExampleResult:
    return ExampleResult(
        example_id=example_id,
        difficulty=difficulty,  # type: ignore[arg-type]
        match=_match(found=found, fps=fps, traps=traps),
        judge_score=judge_score,
        judge_rationale="ok" if judge_score is not None else None,
        judge_error=judge_error,
        latency_ms=latency_ms,
        review_cost_usd=review_cost_usd,
        judge_cost_usd=judge_cost_usd,
    )


_BASE_KW: dict = {
    "run_id": "test-run",
    "agent_version": "abc123",
    "prompt_version": "v0.2",
    "judge_version": "main_judge_v1",
    "judge_model": "claude-sonnet-4-5",
    "dataset_version": "v1",
    "created_at": datetime(2026, 5, 24, 12, 0, tzinfo=UTC),
}


class TestPercentile:
    def test_empty(self) -> None:
        assert percentile([], 0.5) == 0

    def test_single(self) -> None:
        assert percentile([42], 0.5) == 42

    def test_p50_p95(self) -> None:
        values = list(range(1, 101))  # 1..100
        assert percentile(values, 0.50) in (50, 51)
        assert percentile(values, 0.95) in (95, 96)

    def test_bad_pct(self) -> None:
        with pytest.raises(ValueError):
            percentile([1, 2, 3], 1.5)


class TestBuildSummary:
    def test_empty_results(self) -> None:
        summary = build_summary(**_BASE_KW, results=[])
        assert summary.example_count == 0
        assert summary.judge_score == 0.0
        assert summary.deterministic_score == 0.0
        assert summary.false_positive_rate == 0.0
        assert summary.trap_rate == 0.0
        assert summary.p50_latency_ms == 0
        assert summary.p95_latency_ms == 0
        assert summary.total_cost_usd == 0.0
        assert summary.verdict == "below-bar"
        assert summary.delta is None

    def test_all_correct_passing_bars(self) -> None:
        results = [
            _result(example_id="a", judge_score=1.0, latency_ms=1000),
            _result(example_id="b", judge_score=0.9, latency_ms=1500),
            _result(example_id="c", judge_score=0.8, latency_ms=2000),
        ]
        summary = build_summary(**_BASE_KW, results=results)
        assert summary.example_count == 3
        assert summary.judge_score == pytest.approx(0.9)
        assert summary.deterministic_score == 1.0
        assert summary.false_positive_rate == 0.0
        assert summary.verdict == "pass"
        assert summary.failed_judge_count == 0

    def test_false_positive_aggregation(self) -> None:
        results = [
            _result(example_id="a", fps=2),
            _result(example_id="b", fps=1),
            _result(example_id="c", fps=0),
        ]
        summary = build_summary(**_BASE_KW, results=results)
        assert summary.false_positive_rate == pytest.approx(1.0)

    def test_trap_rate(self) -> None:
        results = [
            _result(example_id="a", traps=1),
            _result(example_id="b", traps=2),
            _result(example_id="c", traps=0),
            _result(example_id="d", traps=0),
        ]
        summary = build_summary(**_BASE_KW, results=results)
        assert summary.trap_rate == pytest.approx(0.5)

    def test_below_bar_low_judge_score(self) -> None:
        results = [_result(judge_score=0.3)]
        summary = build_summary(**_BASE_KW, results=results)
        assert summary.verdict == "below-bar"

    def test_below_bar_expensive(self) -> None:
        results = [_result(review_cost_usd=0.10, judge_cost_usd=0.01)]
        summary = build_summary(**_BASE_KW, results=results)
        assert summary.verdict == "below-bar"
        assert summary.mean_cost_per_review_usd > 0.05

    def test_judge_failure_excluded_from_mean(self) -> None:
        results = [
            _result(example_id="a", judge_score=1.0),
            _result(example_id="b", judge_score=None, judge_error="bad json"),
        ]
        summary = build_summary(**_BASE_KW, results=results)
        assert summary.judge_score == 1.0  # only the passing judge counted
        assert summary.failed_judge_count == 1

    def test_difficulty_breakdown(self) -> None:
        results = [
            _result(example_id="e1", difficulty="easy", found=True),
            _result(example_id="e2", difficulty="easy", found=False),
            _result(example_id="m1", difficulty="medium", found=True, judge_score=0.5),
            _result(example_id="h1", difficulty="hard", found=False, judge_score=0.2),
        ]
        summary = build_summary(**_BASE_KW, results=results)
        assert summary.by_difficulty["easy"].count == 2
        assert summary.by_difficulty["easy"].deterministic_score == 0.5
        assert summary.by_difficulty["medium"].count == 1
        assert summary.by_difficulty["medium"].judge_score == pytest.approx(0.5)
        assert summary.by_difficulty["hard"].count == 1
        assert summary.by_difficulty["hard"].judge_score == pytest.approx(0.2)

    def test_empty_difficulty_slice(self) -> None:
        results = [_result(difficulty="easy")]
        summary = build_summary(**_BASE_KW, results=results)
        assert summary.by_difficulty["hard"].count == 0
        assert summary.by_difficulty["hard"].judge_score is None


class TestDelta:
    def test_delta_positive_and_negative(self) -> None:
        prior_results = [_result(judge_score=0.5, latency_ms=2000)]
        prior = build_summary(**_BASE_KW, results=prior_results)

        new_kw = {**_BASE_KW, "run_id": "newer"}
        new_results = [_result(judge_score=0.8, latency_ms=1500)]
        summary = build_summary(**new_kw, results=new_results, prior=prior)

        assert summary.delta is not None
        assert summary.delta["judge_score"] == pytest.approx(0.3)
        assert summary.delta["p50_latency_ms"] < 0

    def test_no_prior_no_delta(self) -> None:
        results = [_result()]
        summary = build_summary(**_BASE_KW, results=results)
        assert summary.delta is None


class TestSerde:
    def test_round_trip(self, tmp_path: Path) -> None:
        results = [_result(example_id="a"), _result(example_id="b", judge_score=0.6)]
        original = build_summary(**_BASE_KW, results=results)
        path = tmp_path / "summary.json"
        dump_summary(original, path)
        assert path.exists()
        loaded = load_summary(path)
        assert isinstance(loaded, RunSummary)
        assert loaded.judge_score == pytest.approx(original.judge_score)
        assert loaded.run_id == original.run_id
        assert loaded.by_difficulty["easy"].count == original.by_difficulty["easy"].count


class TestFindLatest:
    def test_returns_none_when_missing(self, tmp_path: Path) -> None:
        assert find_latest_summary(tmp_path / "nope") is None
        assert find_latest_summary(tmp_path) is None

    def test_picks_most_recent(self, tmp_path: Path) -> None:
        early = build_summary(
            **{**_BASE_KW, "run_id": "early", "created_at": datetime(2026, 5, 1, tzinfo=UTC)},
            results=[_result(judge_score=0.4)],
        )
        late = build_summary(
            **{**_BASE_KW, "run_id": "late", "created_at": datetime(2026, 5, 20, tzinfo=UTC)},
            results=[_result(judge_score=0.9)],
        )
        dump_summary(early, tmp_path / "early" / "summary.json")
        dump_summary(late, tmp_path / "late" / "summary.json")

        found = find_latest_summary(tmp_path)
        assert found is not None
        assert found.run_id == "late"

    def test_skips_malformed_summary(self, tmp_path: Path) -> None:
        good = build_summary(**_BASE_KW, results=[_result()])
        dump_summary(good, tmp_path / "good" / "summary.json")
        bad_dir = tmp_path / "bad"
        bad_dir.mkdir()
        (bad_dir / "summary.json").write_text("not valid json")

        found = find_latest_summary(tmp_path)
        assert found is not None
        assert found.run_id == good.run_id
