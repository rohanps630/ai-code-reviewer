"""Severity scorer.

Severity is ordered ({minor < major < critical}), so we can grade by
distance: exact match → 1.0, off-by-one → 0.5, off-by-two → 0.0.
"""

from __future__ import annotations

from evals.schema import GroundTruthFinding
from evals.scorers.types import PredictedFinding, Severity

_SEVERITY_RANK: dict[Severity, int] = {"minor": 0, "major": 1, "critical": 2}


def severity_score(predicted: PredictedFinding, truth: GroundTruthFinding) -> float:
    distance = abs(_SEVERITY_RANK[predicted.severity] - _SEVERITY_RANK[truth.severity])
    if distance == 0:
        return 1.0
    if distance == 1:
        return 0.5
    return 0.0
