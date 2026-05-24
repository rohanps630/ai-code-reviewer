"""Schema + dataset-loader tests for evals.schema."""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from evals.schema import (
    DuplicateExampleIdError,
    EvalExample,
    GroundTruth,
    GroundTruthFinding,
    load_examples_jsonl,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
DATASET_V1 = REPO_ROOT / "evals" / "datasets" / "v1" / "examples.jsonl"


def _valid_example(**overrides: object) -> dict:
    base: dict = {
        "id": "ex-1",
        "pr_url": None,
        "pr_title": "Fix something",
        "pr_diff": "diff --git a/x b/x\n",
        "ground_truth": {
            "findings": [
                {
                    "category": "bug",
                    "severity": "major",
                    "summary": "Null deref",
                    "location_hint": "x:1",
                    "source_comment_url": None,
                }
            ],
            "expected_findings_count": 1,
            "false_positive_traps": [],
        },
        "difficulty": "easy",
        "added_at": "2026-05-24",
        "added_by": "rohanpsuresh",
    }
    base.update(overrides)
    return base


class TestEvalExample:
    def test_parses_minimum_valid(self) -> None:
        ex = EvalExample.model_validate(_valid_example())
        assert ex.id == "ex-1"
        assert ex.difficulty == "easy"
        assert ex.ground_truth.expected_findings_count == 1

    def test_rejects_unknown_top_level_field(self) -> None:
        with pytest.raises(ValidationError):
            EvalExample.model_validate(_valid_example(extra_field="nope"))

    def test_rejects_bad_id(self) -> None:
        with pytest.raises(ValidationError):
            EvalExample.model_validate(_valid_example(id="UPPER_CASE"))
        with pytest.raises(ValidationError):
            EvalExample.model_validate(_valid_example(id="-leading-dash"))

    def test_rejects_unknown_difficulty(self) -> None:
        with pytest.raises(ValidationError):
            EvalExample.model_validate(_valid_example(difficulty="trivial"))

    def test_pr_url_optional_but_validated_when_set(self) -> None:
        valid = EvalExample.model_validate(
            _valid_example(pr_url="https://github.com/owner/repo/pull/1")
        )
        assert str(valid.pr_url).startswith("https://github.com/")
        with pytest.raises(ValidationError):
            EvalExample.model_validate(_valid_example(pr_url="not-a-url"))


class TestGroundTruth:
    def test_count_must_match_findings(self) -> None:
        bad = {
            "findings": [
                {"category": "bug", "severity": "minor", "summary": "x"},
            ],
            "expected_findings_count": 2,
            "false_positive_traps": [],
        }
        with pytest.raises(ValidationError):
            GroundTruth.model_validate(bad)

    def test_requires_at_least_one_finding(self) -> None:
        with pytest.raises(ValidationError):
            GroundTruth.model_validate(
                {"findings": [], "expected_findings_count": 0, "false_positive_traps": []}
            )

    def test_finding_category_and_severity_enforced(self) -> None:
        with pytest.raises(ValidationError):
            GroundTruthFinding.model_validate(
                {"category": "typo", "severity": "minor", "summary": "x"}
            )
        with pytest.raises(ValidationError):
            GroundTruthFinding.model_validate(
                {"category": "bug", "severity": "blocker", "summary": "x"}
            )


class TestLoadExamplesJsonl:
    def test_skips_blank_and_comment_lines(self, tmp_path: Path) -> None:
        example_json = EvalExample.model_validate(_valid_example()).model_dump_json()
        f = tmp_path / "examples.jsonl"
        f.write_text(f"# a header comment\n\n{example_json}\n")
        loaded = load_examples_jsonl(f)
        assert len(loaded) == 1

    def test_raises_on_duplicate_id(self, tmp_path: Path) -> None:
        line = EvalExample.model_validate(_valid_example()).model_dump_json()
        f = tmp_path / "dup.jsonl"
        f.write_text(f"{line}\n{line}\n")
        with pytest.raises(DuplicateExampleIdError):
            load_examples_jsonl(f)


class TestDatasetV1:
    """Guard the checked-in seed dataset — fails the build if it stops parsing."""

    def test_dataset_v1_loads(self) -> None:
        examples = load_examples_jsonl(DATASET_V1)
        assert len(examples) >= 5

    def test_dataset_v1_ids_are_unique(self) -> None:
        examples = load_examples_jsonl(DATASET_V1)
        ids = [e.id for e in examples]
        assert len(ids) == len(set(ids))

    def test_dataset_v1_covers_all_difficulties(self) -> None:
        examples = load_examples_jsonl(DATASET_V1)
        difficulties = {e.difficulty for e in examples}
        assert difficulties == {"easy", "medium", "hard"}
