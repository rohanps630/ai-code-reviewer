"""Eval runner orchestrator.

Walks a list of `EvalExample`s, asks the agent bridge to produce a
review, scores it deterministically + with the LLM judge, and emits
one `ExampleResult` per example. Per-example traces (the raw record
for `evals/results/<run-id>/raw/<id>.json`) are written when
`output_dir` is supplied.

The runner is pure-ish: the only side effects are
- calling `bridge(example)` (user-supplied callable; tests pass a stub),
- calling `judge_example(client, ...)` (tests pass a fake client),
- writing trace files when an output dir is given.

A judge failure is captured per-example rather than aborting the run.
This matches the harness's job of producing a complete summary even
when individual examples blow up — the failure shows up in
`failed_judge_count` and the per-example trace's `judge_error` field.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field

from evals.judge import (
    DEFAULT_JUDGE_MODEL,
    AnthropicClient,
    JudgeError,
    JudgeResult,
    judge_example,
)
from evals.pricing import anthropic_cost_usd
from evals.schema import EvalExample
from evals.scorers.findings import MatchResult, match_findings
from evals.scorers.types import PredictedReview
from evals.summary import ExampleResult


@dataclass(frozen=True)
class BridgeResult:
    """What the agent bridge hands back per example."""

    review: PredictedReview
    latency_ms: int
    cost_usd: float


class AgentBridge(Protocol):
    """Callable interface for invoking the TS agent.

    The Python runner doesn't care whether this is a subprocess.run on
    a Node CLI (4.6), an in-process fake (tests), or eventually a
    direct API call.
    """

    def __call__(self, example: EvalExample) -> BridgeResult: ...


class _MatchTrace(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    found_ground_truth_bug: bool
    false_positives: int = Field(ge=0)
    false_positive_traps_triggered: int = Field(ge=0)
    matched_truth_indices: list[int]
    unmatched_truth_indices: list[int]


class _BridgeTrace(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    review: PredictedReview
    latency_ms: int
    cost_usd: float


class _JudgeTrace(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    score: float
    rationale: str
    judge_version: str
    model: str
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_creation_tokens: int
    cost_usd: float


class ExampleTrace(BaseModel):
    """The full per-example record persisted to raw/<id>.json."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    example_id: str
    difficulty: str
    bridge: _BridgeTrace
    judge: _JudgeTrace | None
    judge_error: str | None
    match: _MatchTrace


def _match_to_trace(match: MatchResult) -> _MatchTrace:
    return _MatchTrace(
        found_ground_truth_bug=match.found_ground_truth_bug,
        false_positives=match.false_positives,
        false_positive_traps_triggered=match.false_positive_traps_triggered,
        matched_truth_indices=[m.truth_index for m in match.matches],
        unmatched_truth_indices=list(match.unmatched_truth_indices),
    )


def _judge_to_trace(judge: JudgeResult, cost_usd: float) -> _JudgeTrace:
    return _JudgeTrace(
        score=judge.score,
        rationale=judge.rationale,
        judge_version=judge.judge_version,
        model=judge.model,
        input_tokens=judge.input_tokens,
        output_tokens=judge.output_tokens,
        cache_read_tokens=judge.cache_read_tokens,
        cache_creation_tokens=judge.cache_creation_tokens,
        cost_usd=cost_usd,
    )


def _write_trace(output_dir: Path, trace: ExampleTrace) -> None:
    raw_dir = output_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / f"{trace.example_id}.json").write_text(trace.model_dump_json(indent=2) + "\n")


def run_eval(
    *,
    examples: list[EvalExample],
    bridge: AgentBridge,
    judge_client: AnthropicClient,
    judge_model: str = DEFAULT_JUDGE_MODEL,
    output_dir: Path | None = None,
    on_example_start: Callable[[EvalExample], None] | None = None,
    on_example_done: Callable[[EvalExample, ExampleResult], None] | None = None,
) -> list[ExampleResult]:
    """Run the bridge + scorers + judge over every example."""
    results: list[ExampleResult] = []

    for example in examples:
        if on_example_start is not None:
            on_example_start(example)

        bridge_result = bridge(example)

        match = match_findings(list(bridge_result.review.findings), example.ground_truth)

        judge_result: JudgeResult | None = None
        judge_error: str | None = None
        judge_cost_usd = 0.0
        try:
            judge_result = judge_example(
                judge_client,
                example=example,
                prediction=bridge_result.review,
                model=judge_model,
            )
            judge_cost_usd = anthropic_cost_usd(
                judge_result.model,
                input_tokens=judge_result.input_tokens,
                output_tokens=judge_result.output_tokens,
                cache_read_tokens=judge_result.cache_read_tokens,
                cache_creation_tokens=judge_result.cache_creation_tokens,
            )
        except JudgeError as exc:
            judge_error = str(exc)

        result = ExampleResult(
            example_id=example.id,
            difficulty=example.difficulty,
            match=match,
            judge_score=judge_result.score if judge_result else None,
            judge_rationale=judge_result.rationale if judge_result else None,
            judge_error=judge_error,
            latency_ms=bridge_result.latency_ms,
            review_cost_usd=bridge_result.cost_usd,
            judge_cost_usd=judge_cost_usd,
        )
        results.append(result)

        if output_dir is not None:
            trace = ExampleTrace(
                example_id=example.id,
                difficulty=example.difficulty,
                bridge=_BridgeTrace(
                    review=bridge_result.review,
                    latency_ms=bridge_result.latency_ms,
                    cost_usd=bridge_result.cost_usd,
                ),
                judge=_judge_to_trace(judge_result, judge_cost_usd) if judge_result else None,
                judge_error=judge_error,
                match=_match_to_trace(match),
            )
            _write_trace(output_dir, trace)

        if on_example_done is not None:
            on_example_done(example, result)

    return results
