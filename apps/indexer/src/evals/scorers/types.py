"""Pydantic models for the agent's predicted output.

These mirror the TypeScript `Finding` and `ReviewOutput` shapes in
`packages/agent/src/types.ts`. The agent emits camelCase JSON
(`locationHint`); Pydantic aliases let us keep snake_case attributes
on the Python side while accepting the wire format directly.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Severity = Literal["critical", "major", "minor"]
Category = Literal["bug", "perf", "security", "style", "logic"]
Confidence = Literal["high", "medium", "low"]


class PredictedFinding(BaseModel):
    """A single finding produced by the agent."""

    model_config = ConfigDict(
        populate_by_name=True,
        extra="forbid",
        frozen=True,
    )

    category: Category
    severity: Severity
    summary: str = Field(min_length=1)
    location_hint: str | None = Field(default=None, alias="locationHint")
    suggestion: str | None = None


class PredictedReview(BaseModel):
    """The agent's full review output."""

    model_config = ConfigDict(
        populate_by_name=True,
        extra="forbid",
        frozen=True,
    )

    summary: str = Field(min_length=1)
    findings: list[PredictedFinding]
    confidence: Confidence
