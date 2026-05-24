"""Category scorer.

Categories ({bug, perf, security, style, logic}) are too distinct to
grade on a gradient — security flagged as style is just wrong. Exact
match → 1.0, anything else → 0.0.
"""

from __future__ import annotations

from evals.schema import GroundTruthFinding
from evals.scorers.types import PredictedFinding


def category_score(predicted: PredictedFinding, truth: GroundTruthFinding) -> float:
    return 1.0 if predicted.category == truth.category else 0.0
