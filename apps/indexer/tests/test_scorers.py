"""Tests for the deterministic scorers."""

from __future__ import annotations

import pytest

from evals.schema import GroundTruth, GroundTruthFinding
from evals.scorers import (
    PredictedFinding,
    PredictedReview,
    category_score,
    jaccard,
    location_score,
    match_findings,
    parse_location,
    severity_score,
    summary_match,
    tokenize,
)


def _truth(**overrides: object) -> GroundTruthFinding:
    base: dict = {
        "category": "bug",
        "severity": "major",
        "summary": "Null deref on missing user",
        "location_hint": "src/auth.py:42",
        "source_comment_url": None,
    }
    base.update(overrides)
    return GroundTruthFinding.model_validate(base)


def _pred(**overrides: object) -> PredictedFinding:
    base: dict = {
        "category": "bug",
        "severity": "major",
        "summary": "Null deref on missing user",
        "location_hint": "src/auth.py:42",
        "suggestion": None,
    }
    base.update(overrides)
    return PredictedFinding.model_validate(base)


class TestPredictedTypes:
    def test_accepts_camel_case_wire_format(self) -> None:
        finding = PredictedFinding.model_validate(
            {
                "category": "bug",
                "severity": "major",
                "summary": "x",
                "locationHint": "f:1",
            }
        )
        assert finding.location_hint == "f:1"

    def test_round_trip_snake_case(self) -> None:
        finding = _pred()
        dumped = finding.model_dump()
        assert "location_hint" in dumped
        assert "locationHint" not in dumped

    def test_review_parses_full_payload(self) -> None:
        review = PredictedReview.model_validate(
            {
                "summary": "Looks risky",
                "confidence": "high",
                "findings": [
                    {"category": "bug", "severity": "minor", "summary": "x"},
                ],
            }
        )
        assert review.confidence == "high"
        assert len(review.findings) == 1


class TestTokens:
    def test_lowercase_split_and_stopwords(self) -> None:
        tokens = tokenize("The user is missing from the cache")
        assert "user" in tokens
        assert "missing" in tokens
        assert "cache" in tokens
        assert "the" not in tokens
        assert "is" not in tokens

    def test_plural_collapse(self) -> None:
        tokens = tokenize("users tokens raises classes")
        assert "user" in tokens
        assert "token" in tokens
        # "raises" → "raise"; "classes" stays because ends with "ss"-adjacent
        assert "raise" in tokens
        assert "classes" in tokens or "classe" in tokens

    def test_jaccard_edges(self) -> None:
        assert jaccard(set(), set()) == 1.0
        assert jaccard({"a"}, set()) == 0.0
        assert jaccard({"a", "b"}, {"a", "b"}) == 1.0
        assert jaccard({"a", "b"}, {"a"}) == pytest.approx(0.5)

    def test_summary_match_real_world_pair(self) -> None:
        truth = (
            "Drops the None-check on users.get(...); calling .name on a "
            "missing user raises AttributeError."
        )
        good = (
            "The PR removes the None check on the users.get() result; "
            ".name on a missing user raises AttributeError."
        )
        bad = "The variable name was changed but the logic is the same."
        assert summary_match(good, truth) is True
        assert summary_match(bad, truth) is False

    def test_summary_match_threshold_tunable(self) -> None:
        # alpha/beta/gamma vs alpha/delta/epsilon → Jaccard 1/5 = 0.2
        assert summary_match("alpha beta gamma", "alpha delta epsilon", threshold=0.0) is True
        assert summary_match("alpha beta gamma", "alpha delta epsilon", threshold=0.5) is False

    def test_summary_match_empty_strings_match_each_other(self) -> None:
        # Both sides tokenize to empty -> Jaccard 1.0. Documented behavior.
        assert summary_match("", "") is True


class TestCategory:
    def test_exact_match(self) -> None:
        assert category_score(_pred(category="bug"), _truth(category="bug")) == 1.0

    def test_mismatch(self) -> None:
        assert category_score(_pred(category="bug"), _truth(category="security")) == 0.0


class TestSeverity:
    def test_exact(self) -> None:
        assert severity_score(_pred(severity="major"), _truth(severity="major")) == 1.0

    def test_off_by_one(self) -> None:
        assert severity_score(_pred(severity="minor"), _truth(severity="major")) == 0.5
        assert severity_score(_pred(severity="critical"), _truth(severity="major")) == 0.5

    def test_off_by_two(self) -> None:
        assert severity_score(_pred(severity="minor"), _truth(severity="critical")) == 0.0


class TestParseLocation:
    def test_path_and_line(self) -> None:
        loc = parse_location("src/foo.py:42")
        assert loc is not None
        assert loc.path == "src/foo.py"
        assert loc.start_line == 42
        assert loc.end_line is None

    def test_path_and_range(self) -> None:
        loc = parse_location("src/foo.py:42-58")
        assert loc is not None
        assert loc.start_line == 42
        assert loc.end_line == 58

    def test_path_only(self) -> None:
        loc = parse_location("src/foo.py")
        assert loc is not None
        assert loc.path == "src/foo.py"
        assert loc.start_line is None

    def test_none_and_blank(self) -> None:
        assert parse_location(None) is None
        assert parse_location("") is None
        assert parse_location("   ") is None


class TestLocationScore:
    def test_files_differ(self) -> None:
        assert location_score(_pred(location_hint="a.py:1"), _truth(location_hint="b.py:1")) == 0.0

    def test_files_match_close_lines(self) -> None:
        score = location_score(
            _pred(location_hint="src/auth.py:44"),
            _truth(location_hint="src/auth.py:42"),
        )
        assert score == 1.0

    def test_files_match_medium_distance(self) -> None:
        score = location_score(
            _pred(location_hint="src/auth.py:55"),
            _truth(location_hint="src/auth.py:42"),
        )
        assert score == 0.5

    def test_files_match_far_lines(self) -> None:
        score = location_score(
            _pred(location_hint="src/auth.py:200"),
            _truth(location_hint="src/auth.py:42"),
        )
        assert score == 0.3

    def test_one_side_missing_line(self) -> None:
        score = location_score(
            _pred(location_hint="src/auth.py"),
            _truth(location_hint="src/auth.py:42"),
        )
        assert score == 0.7

    def test_neither_side_has_line(self) -> None:
        score = location_score(
            _pred(location_hint="src/auth.py"),
            _truth(location_hint="src/auth.py"),
        )
        assert score == 1.0

    def test_missing_location(self) -> None:
        assert location_score(_pred(location_hint=None), _truth(location_hint="x:1")) == 0.0
        assert location_score(_pred(location_hint="x:1"), _truth(location_hint=None)) == 0.0

    def test_overlapping_ranges(self) -> None:
        # truth 40-50, pred 45-48 → overlap → distance 0 → 1.0
        score = location_score(
            _pred(location_hint="src/auth.py:45-48"),
            _truth(location_hint="src/auth.py:40-50"),
        )
        assert score == 1.0


def _gt(findings: list[dict], traps: list[str] | None = None) -> GroundTruth:
    return GroundTruth.model_validate(
        {
            "findings": findings,
            "expected_findings_count": len(findings),
            "false_positive_traps": traps or [],
        }
    )


class TestMatchFindings:
    def test_single_correct_finding(self) -> None:
        gt = _gt(
            [
                {
                    "category": "bug",
                    "severity": "major",
                    "summary": "Drops the None-check on users.get; AttributeError at runtime.",
                }
            ]
        )
        preds = [
            _pred(
                summary=("PR removes the None check on users.get result; AttributeError at runtime")
            )
        ]
        result = match_findings(preds, gt)
        assert result.found_ground_truth_bug is True
        assert result.false_positives == 0
        assert result.false_positive_traps_triggered == 0
        assert len(result.matches) == 1
        assert result.matches[0].truth_index == 0
        assert result.unmatched_truth_indices == ()

    def test_false_positive(self) -> None:
        gt = _gt([{"category": "bug", "severity": "major", "summary": "Null deref on user"}])
        preds = [_pred(summary="Inefficient memory allocation in loop")]
        result = match_findings(preds, gt)
        assert result.found_ground_truth_bug is False
        assert result.false_positives == 1
        assert result.false_positive_traps_triggered == 0
        assert result.unmatched_truth_indices == (0,)

    def test_trap_triggered(self) -> None:
        gt = _gt(
            [{"category": "bug", "severity": "major", "summary": "Null deref on user"}],
            traps=["The renamed variable on line 30 is intentional and not a bug"],
        )
        preds = [
            _pred(summary="The renamed variable on line 30 looks suspicious and should be reverted")
        ]
        result = match_findings(preds, gt)
        assert result.found_ground_truth_bug is False
        assert result.false_positives == 0
        assert result.false_positive_traps_triggered == 1

    def test_greedy_1_to_1_no_double_match(self) -> None:
        gt = _gt(
            [
                {"category": "bug", "severity": "major", "summary": "Null deref on missing user"},
                {"category": "bug", "severity": "minor", "summary": "Unused import statement"},
            ]
        )
        # Both predictions look like the first truth — only one should pair.
        preds = [
            _pred(summary="Null deref on missing user when lookup fails"),
            _pred(summary="Null deref when user is missing from lookup"),
        ]
        result = match_findings(preds, gt)
        assert result.found_ground_truth_bug is True
        assert len(result.matches) == 1
        # Second prediction is an FP because the only matching truth is taken.
        assert result.false_positives == 1
        assert result.unmatched_truth_indices == (1,)

    def test_empty_predictions(self) -> None:
        gt = _gt([{"category": "bug", "severity": "major", "summary": "x"}])
        result = match_findings([], gt)
        assert result.found_ground_truth_bug is False
        assert result.false_positives == 0
        assert result.unmatched_truth_indices == (0,)
