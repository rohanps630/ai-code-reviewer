"""Match predicted findings against ground truth + count FPs / traps.

Per `docs/evals.md`, the deterministic scorer reports three per-example
counts:

- `found_ground_truth_bug`: at least one prediction matches at least one
  truth finding via the semantic-match function.
- `false_positives`: predictions that don't match any truth finding AND
  don't match any entry in `false_positive_traps`.
- `false_positive_traps_triggered`: predictions that match a trap.

A prediction matches at most one truth finding (whichever is closest by
Jaccard similarity). Ties are broken by the truth-finding order, which
is stable across runs.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from evals.schema import GroundTruth, GroundTruthFinding
from evals.scorers.tokens import (
    DEFAULT_SUMMARY_MATCH_THRESHOLD,
    summary_similarity,
)
from evals.scorers.types import PredictedFinding


@dataclass(frozen=True)
class MatchedFinding:
    """One predicted/truth pairing produced by `match_findings`."""

    predicted_index: int
    truth_index: int
    similarity: float


@dataclass(frozen=True)
class MatchResult:
    """Per-example aggregate over predicted findings vs ground truth."""

    matches: tuple[MatchedFinding, ...] = field(default_factory=tuple)
    found_ground_truth_bug: bool = False
    false_positives: int = 0
    false_positive_traps_triggered: int = 0
    unmatched_truth_indices: tuple[int, ...] = field(default_factory=tuple)


def _best_match(
    predicted: PredictedFinding,
    truths: list[GroundTruthFinding],
    used_truth_indices: set[int],
    threshold: float,
) -> tuple[int, float] | None:
    """Return (truth_index, similarity) for the best still-available truth, or None."""
    best: tuple[int, float] | None = None
    for i, truth in enumerate(truths):
        if i in used_truth_indices:
            continue
        sim = summary_similarity(predicted.summary, truth.summary)
        if sim < threshold:
            continue
        if best is None or sim > best[1]:
            best = (i, sim)
    return best


def _matches_any_trap(summary: str, traps: list[str], threshold: float) -> bool:
    return any(summary_similarity(summary, trap) >= threshold for trap in traps)


def match_findings(
    predictions: list[PredictedFinding],
    ground_truth: GroundTruth,
    threshold: float = DEFAULT_SUMMARY_MATCH_THRESHOLD,
) -> MatchResult:
    """Greedy 1-to-1 match: each prediction takes its best still-free truth."""
    truths = list(ground_truth.findings)
    traps = list(ground_truth.false_positive_traps)

    used_truths: set[int] = set()
    matches: list[MatchedFinding] = []
    false_positives = 0
    traps_triggered = 0

    for pred_idx, prediction in enumerate(predictions):
        best = _best_match(prediction, truths, used_truths, threshold)
        if best is not None:
            truth_idx, sim = best
            used_truths.add(truth_idx)
            matches.append(
                MatchedFinding(
                    predicted_index=pred_idx,
                    truth_index=truth_idx,
                    similarity=sim,
                )
            )
            continue
        # No truth match — check if it's a trap.
        if _matches_any_trap(prediction.summary, traps, threshold):
            traps_triggered += 1
        else:
            false_positives += 1

    unmatched = tuple(i for i in range(len(truths)) if i not in used_truths)
    return MatchResult(
        matches=tuple(matches),
        found_ground_truth_bug=bool(matches),
        false_positives=false_positives,
        false_positive_traps_triggered=traps_triggered,
        unmatched_truth_indices=unmatched,
    )
