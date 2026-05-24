"""Deterministic scorers for the eval harness.

Pure functions over `(predicted, ground_truth)` pairs. No I/O, no LLM
calls — those live in `evals.judge`. Everything in this subpackage is
test-only deterministic so per-example scores are reproducible.
"""

from __future__ import annotations

from evals.scorers.category import category_score
from evals.scorers.findings import MatchedFinding, MatchResult, match_findings
from evals.scorers.location import location_score, parse_location
from evals.scorers.severity import severity_score
from evals.scorers.tokens import jaccard, summary_match, tokenize
from evals.scorers.types import PredictedFinding, PredictedReview

__all__ = [
    "MatchResult",
    "MatchedFinding",
    "PredictedFinding",
    "PredictedReview",
    "category_score",
    "jaccard",
    "location_score",
    "match_findings",
    "parse_location",
    "severity_score",
    "summary_match",
    "tokenize",
]
