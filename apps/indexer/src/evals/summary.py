"""Build, persist, and diff `RunSummary` artifacts.

A `RunSummary` is the top-of-run artifact written to
`evals/results/<run-id>/summary.json`. It carries every aggregate the
PR-comment workflow needs (quality, perf, cost), the verdict against
the Phase-4-ship bars in `docs/evals.md`, and a delta vs a prior run
(typically the most recent main-branch run).

This module is pure: no I/O happens inside `build_summary`. The
`dump_summary` / `load_summary` helpers do disk I/O but are trivially
mockable in tests.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from evals.scorers.findings import MatchResult

Difficulty = Literal["easy", "medium", "hard"]
Verdict = Literal["pass", "below-bar"]


# Phase-4-ship pass bars, from docs/evals.md → "What a good run looks like".
# These are lower bounds for the quality metrics and upper bounds for FP /
# cost. Bumping them is a deliberate move tied to a phase ship.
PASS_BARS: dict[str, float] = {
    "judge_score_min": 0.55,
    "deterministic_score_min": 0.40,
    "false_positive_rate_max": 1.5,
    "mean_cost_per_review_usd_max": 0.05,
}


@dataclass(frozen=True)
class ExampleResult:
    """Per-example outcome handed to `build_summary`.

    Internal to the eval harness — not part of the persisted summary.
    Per-example trace files (one per example) are written separately by
    the runner in 4.5.
    """

    example_id: str
    difficulty: Difficulty
    match: MatchResult
    judge_score: float | None
    judge_rationale: str | None
    judge_error: str | None
    latency_ms: int
    review_cost_usd: float
    judge_cost_usd: float


class DifficultyBreakdown(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    count: int = Field(ge=0)
    judge_score: float | None
    deterministic_score: float = Field(ge=0.0, le=1.0)
    false_positive_rate: float = Field(ge=0.0)
    trap_rate: float = Field(ge=0.0, le=1.0)


class RunSummary(BaseModel):
    """Top-of-run aggregate. Persisted to summary.json."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    run_id: str
    created_at: datetime
    agent_version: str
    prompt_version: str
    judge_version: str
    judge_model: str
    dataset_version: str

    example_count: int = Field(ge=0)

    judge_score: float = Field(ge=0.0, le=1.0)
    deterministic_score: float = Field(ge=0.0, le=1.0)
    false_positive_rate: float = Field(ge=0.0)
    trap_rate: float = Field(ge=0.0, le=1.0)

    p50_latency_ms: int = Field(ge=0)
    p95_latency_ms: int = Field(ge=0)

    mean_cost_per_review_usd: float = Field(ge=0.0)
    total_cost_usd: float = Field(ge=0.0)

    failed_judge_count: int = Field(ge=0)

    by_difficulty: dict[str, DifficultyBreakdown]

    delta: dict[str, float] | None = None

    verdict: Verdict


def percentile(values: list[int] | list[float], pct: float) -> int:
    """Linear-interp percentile. `pct` in [0, 1]. Returns 0 on empty input."""
    if not values:
        return 0
    if not (0.0 <= pct <= 1.0):
        raise ValueError(f"pct must be in [0, 1], got {pct}")
    s = sorted(values)
    k = (len(s) - 1) * pct
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return int(s[int(k)])
    return int(s[f] + (s[c] - s[f]) * (k - f))


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _verdict(
    judge_score: float,
    deterministic: float,
    fp_rate: float,
    cost_per_review: float,
) -> Verdict:
    if (
        judge_score >= PASS_BARS["judge_score_min"]
        and deterministic >= PASS_BARS["deterministic_score_min"]
        and fp_rate <= PASS_BARS["false_positive_rate_max"]
        and cost_per_review <= PASS_BARS["mean_cost_per_review_usd_max"]
    ):
        return "pass"
    return "below-bar"


def _difficulty_slice(results: list[ExampleResult], difficulty: Difficulty) -> DifficultyBreakdown:
    sliced = [r for r in results if r.difficulty == difficulty]
    if not sliced:
        return DifficultyBreakdown(
            count=0,
            judge_score=None,
            deterministic_score=0.0,
            false_positive_rate=0.0,
            trap_rate=0.0,
        )
    judge_scores = [r.judge_score for r in sliced if r.judge_score is not None]
    return DifficultyBreakdown(
        count=len(sliced),
        judge_score=_mean(judge_scores) if judge_scores else None,
        deterministic_score=sum(1 for r in sliced if r.match.found_ground_truth_bug) / len(sliced),
        false_positive_rate=_mean([float(r.match.false_positives) for r in sliced]),
        trap_rate=sum(1 for r in sliced if r.match.false_positive_traps_triggered > 0)
        / len(sliced),
    )


def _delta_against(current: RunSummary, prior: RunSummary) -> dict[str, float]:
    """Per-metric deltas. Positive = current > prior, negative = current < prior."""
    return {
        "judge_score": round(current.judge_score - prior.judge_score, 4),
        "deterministic_score": round(current.deterministic_score - prior.deterministic_score, 4),
        "false_positive_rate": round(current.false_positive_rate - prior.false_positive_rate, 4),
        "trap_rate": round(current.trap_rate - prior.trap_rate, 4),
        "p50_latency_ms": float(current.p50_latency_ms - prior.p50_latency_ms),
        "p95_latency_ms": float(current.p95_latency_ms - prior.p95_latency_ms),
        "mean_cost_per_review_usd": round(
            current.mean_cost_per_review_usd - prior.mean_cost_per_review_usd, 6
        ),
        "total_cost_usd": round(current.total_cost_usd - prior.total_cost_usd, 6),
    }


def build_summary(
    *,
    run_id: str,
    agent_version: str,
    prompt_version: str,
    judge_version: str,
    judge_model: str,
    dataset_version: str,
    results: list[ExampleResult],
    prior: RunSummary | None = None,
    created_at: datetime | None = None,
) -> RunSummary:
    """Aggregate per-example results into a `RunSummary`.

    `results` may be empty (every quality/perf/cost field then reads
    zero, verdict is "below-bar"). When `prior` is provided, the
    summary carries per-metric deltas keyed by field name.
    """
    n = len(results)

    judge_scores = [r.judge_score for r in results if r.judge_score is not None]
    judge_score = _mean(judge_scores) if judge_scores else 0.0

    if n > 0:
        deterministic_score = sum(1 for r in results if r.match.found_ground_truth_bug) / n
        trap_rate = sum(1 for r in results if r.match.false_positive_traps_triggered > 0) / n
    else:
        deterministic_score = 0.0
        trap_rate = 0.0

    false_positive_rate = _mean([float(r.match.false_positives) for r in results])

    latencies = [r.latency_ms for r in results]
    p50 = percentile(latencies, 0.50)
    p95 = percentile(latencies, 0.95)

    per_review_costs = [r.review_cost_usd + r.judge_cost_usd for r in results]
    mean_cost = _mean(per_review_costs)
    total_cost = sum(per_review_costs)

    failed_judges = sum(1 for r in results if r.judge_error is not None)

    by_difficulty = {
        d: _difficulty_slice(results, d)  # type: ignore[arg-type]
        for d in ("easy", "medium", "hard")
    }

    summary = RunSummary(
        run_id=run_id,
        created_at=created_at or datetime.now(UTC),
        agent_version=agent_version,
        prompt_version=prompt_version,
        judge_version=judge_version,
        judge_model=judge_model,
        dataset_version=dataset_version,
        example_count=n,
        judge_score=judge_score,
        deterministic_score=deterministic_score,
        false_positive_rate=false_positive_rate,
        trap_rate=trap_rate,
        p50_latency_ms=p50,
        p95_latency_ms=p95,
        mean_cost_per_review_usd=mean_cost,
        total_cost_usd=total_cost,
        failed_judge_count=failed_judges,
        by_difficulty=by_difficulty,
        delta=None,
        verdict=_verdict(judge_score, deterministic_score, false_positive_rate, mean_cost),
    )

    if prior is None:
        return summary
    return summary.model_copy(update={"delta": _delta_against(summary, prior)})


def dump_summary(summary: RunSummary, path: Path) -> None:
    """Write the summary to `path` as pretty-printed JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(summary.model_dump_json(indent=2) + "\n")


def load_summary(path: Path) -> RunSummary:
    """Load a previously persisted summary."""
    return RunSummary.model_validate_json(path.read_text())


def find_latest_summary(results_root: Path) -> RunSummary | None:
    """Return the most-recent summary under `results_root/*/summary.json`.

    Skips non-directory entries and any directory without a summary.json
    so a half-written / aborted run doesn't poison the comparison.
    """
    if not results_root.exists():
        return None
    candidates: list[tuple[datetime, Path]] = []
    for child in results_root.iterdir():
        if not child.is_dir():
            continue
        candidate = child / "summary.json"
        if not candidate.exists():
            continue
        try:
            summary = load_summary(candidate)
        except Exception:  # noqa: BLE001, S112  malformed JSON shouldn't break a fresh run
            continue
        candidates.append((summary.created_at, candidate))
    if not candidates:
        return None
    candidates.sort(key=lambda t: t[0], reverse=True)
    return load_summary(candidates[0][1])
