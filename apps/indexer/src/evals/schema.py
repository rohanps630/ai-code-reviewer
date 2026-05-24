"""Pydantic schema for golden eval datasets.

A dataset is a JSONL file at `evals/datasets/<version>/examples.jsonl`.
Each line validates to a single `EvalExample`. Once a dataset version is
published, examples are immutable — new examples go in a new version
(see `docs/evals.md`).
"""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

Severity = Literal["critical", "major", "minor"]
Category = Literal["bug", "perf", "security", "style", "logic"]
Difficulty = Literal["easy", "medium", "hard"]


class GroundTruthFinding(BaseModel):
    """A single bug or issue that the agent is expected to flag."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    category: Category
    severity: Severity
    summary: str = Field(min_length=1)
    location_hint: str | None = None
    source_comment_url: HttpUrl | None = None


class GroundTruth(BaseModel):
    """Expected agent behavior for a single example."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    findings: list[GroundTruthFinding] = Field(min_length=1)
    expected_findings_count: int = Field(ge=1)
    false_positive_traps: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _count_matches_findings(self) -> GroundTruth:
        if self.expected_findings_count != len(self.findings):
            raise ValueError(
                f"expected_findings_count ({self.expected_findings_count}) must match "
                f"len(findings) ({len(self.findings)})"
            )
        return self


class EvalExample(BaseModel):
    """One row of a golden dataset."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=r"^[a-z0-9][a-z0-9\-]*$", max_length=80)
    pr_url: HttpUrl | None = None
    pr_title: str = Field(min_length=1)
    pr_diff: str = Field(min_length=1)
    ground_truth: GroundTruth
    difficulty: Difficulty
    added_at: date
    added_by: str = Field(min_length=1)


class DuplicateExampleIdError(ValueError):
    """Raised when the same `id` appears more than once in a dataset."""


def load_examples_jsonl(path: Path) -> list[EvalExample]:
    """Load and validate every example in a dataset's `examples.jsonl`.

    Lines that are blank or start with `#` are skipped, so the file can
    carry section comments. Raises `DuplicateExampleIdError` if two rows
    share an `id`.
    """
    examples: list[EvalExample] = []
    seen: set[str] = set()
    with path.open() as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            example = EvalExample.model_validate_json(line)
            if example.id in seen:
                raise DuplicateExampleIdError(f"duplicate example id: {example.id}")
            seen.add(example.id)
            examples.append(example)
    return examples
