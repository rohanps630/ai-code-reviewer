"""Location scorer.

`location_hint` strings look like `"src/auth.ts:42"` or `"src/auth.ts"`
(no line) or `"src/auth.ts:42-58"` (a range). We parse leniently and
grade on file-match + line distance.

- Files don't match → 0.0
- Files match, no line info on either side → 1.0
- Files match, line distance ≤ 5 → 1.0
- Files match, line distance ≤ 20 → 0.5
- Files match, line distance > 20 → 0.3
- Files match, but only one side has a line → 0.7
- Either side missing entirely → 0.0
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from evals.schema import GroundTruthFinding
from evals.scorers.types import PredictedFinding

# Matches "file.ts:42", "file.ts:42-58", or just "file.ts".
# The path captures anything up to the last colon-followed-by-digit.
_LOCATION_RE = re.compile(r"^(?P<path>[^:]+?)(?::(?P<start>\d+)(?:-(?P<end>\d+))?)?$")


@dataclass(frozen=True)
class ParsedLocation:
    path: str
    start_line: int | None
    end_line: int | None


def parse_location(hint: str | None) -> ParsedLocation | None:
    """Return None for unparseable / empty input; never raises."""
    if not hint:
        return None
    cleaned = hint.strip()
    if not cleaned:
        return None
    match = _LOCATION_RE.match(cleaned)
    if not match:
        return None
    path = match.group("path").strip()
    if not path:
        return None
    start = int(match.group("start")) if match.group("start") else None
    end = int(match.group("end")) if match.group("end") else None
    return ParsedLocation(path=path, start_line=start, end_line=end)


def _line_distance(a_start: int, a_end: int | None, b_start: int, b_end: int | None) -> int:
    """Minimum distance between two line ranges (treats None end as point)."""
    a_lo, a_hi = a_start, a_end if a_end is not None else a_start
    b_lo, b_hi = b_start, b_end if b_end is not None else b_start
    if a_hi < b_lo:
        return b_lo - a_hi
    if b_hi < a_lo:
        return a_lo - b_hi
    return 0  # overlap


def location_score(predicted: PredictedFinding, truth: GroundTruthFinding) -> float:
    pred = parse_location(predicted.location_hint)
    truth_loc = parse_location(truth.location_hint)

    if pred is None or truth_loc is None:
        return 0.0

    # Normalize trailing-slash and identical-tail directories. Cheap path-equality;
    # the eval harness doesn't need full repo resolution at this layer.
    if pred.path != truth_loc.path:
        return 0.0

    pred_has_line = pred.start_line is not None
    truth_has_line = truth_loc.start_line is not None

    if not pred_has_line and not truth_has_line:
        return 1.0
    if pred_has_line != truth_has_line:
        return 0.7

    # Both have lines per the branches above; defensive type guard for the checker.
    if pred.start_line is None or truth_loc.start_line is None:
        return 0.7
    distance = _line_distance(
        pred.start_line, pred.end_line, truth_loc.start_line, truth_loc.end_line
    )
    if distance <= 5:
        return 1.0
    if distance <= 20:
        return 0.5
    return 0.3
