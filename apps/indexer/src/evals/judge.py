"""LLM-as-judge orchestration.

Calls Anthropic Claude with the cached judging rubric (system) + the
per-example payload (user) and parses the JSON response into a typed
`JudgeResult`. The client is injected so tests pass a fake.

This module is the only path in the eval harness that spends real
Anthropic tokens. Wherever it is called, a real key must be present;
build-time tests never instantiate the SDK.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Protocol

from pydantic import BaseModel, Field, ValidationError

from evals.judges import (
    JUDGE_VERSION,
    format_user_message,
    system_prompt,
)
from evals.schema import EvalExample
from evals.scorers.types import PredictedReview

DEFAULT_JUDGE_MODEL = "claude-sonnet-4-5"
DEFAULT_MAX_TOKENS = 1024


class JudgeError(Exception):
    """Raised when the judge response is missing, malformed, or out of range."""


class _JudgeResponseSchema(BaseModel):
    """The shape the judge model is instructed to return."""

    score: float = Field(ge=0.0, le=1.0)
    rationale: str = Field(min_length=1)


@dataclass(frozen=True)
class JudgeResult:
    """Per-example output of `judge_example`."""

    score: float
    rationale: str
    judge_version: str
    model: str
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_creation_tokens: int


class _MessagesAPI(Protocol):
    """Minimal subset of Anthropic SDK `client.messages` the judge uses."""

    def create(self, **kwargs: Any) -> Any: ...


class AnthropicClient(Protocol):
    """Structural type covering the real Anthropic SDK client plus test fakes."""

    messages: _MessagesAPI


_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


def judge_example(
    client: AnthropicClient,
    *,
    example: EvalExample,
    prediction: PredictedReview,
    model: str = DEFAULT_JUDGE_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> JudgeResult:
    """Score one (example, prediction) pair with the LLM-as-judge.

    The system prompt is sent with `cache_control: ephemeral` so the
    same rubric across many examples in a single run gets cached.
    """
    system_block = {
        "type": "text",
        "text": system_prompt(),
        "cache_control": {"type": "ephemeral"},
    }
    user_text = format_user_message(example, prediction)

    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=[system_block],
        messages=[{"role": "user", "content": user_text}],
    )

    text = _extract_text(response)
    parsed = _parse_judge_response(text)
    usage = _extract_usage(response)

    return JudgeResult(
        score=parsed.score,
        rationale=parsed.rationale,
        judge_version=JUDGE_VERSION,
        model=model,
        input_tokens=usage["input_tokens"],
        output_tokens=usage["output_tokens"],
        cache_read_tokens=usage["cache_read_input_tokens"],
        cache_creation_tokens=usage["cache_creation_input_tokens"],
    )


def _extract_text(response: Any) -> str:
    """Pull the first text block out of an Anthropic message response."""
    content = getattr(response, "content", None)
    if not content:
        raise JudgeError("Judge response has no content")
    for block in content:
        if getattr(block, "type", None) == "text":
            text = getattr(block, "text", "")
            if text:
                return text
    raise JudgeError("No non-empty text block in judge response")


def _parse_judge_response(text: str) -> _JudgeResponseSchema:
    """Tolerate ```-fenced JSON and trim before validation."""
    match = _FENCE_RE.search(text)
    payload = match.group(1) if match else text.strip()
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise JudgeError(f"Judge response is not valid JSON: {exc}") from exc
    try:
        return _JudgeResponseSchema.model_validate(data)
    except ValidationError as exc:
        raise JudgeError(f"Judge response failed schema validation: {exc}") from exc


def _extract_usage(response: Any) -> dict[str, int]:
    """Best-effort token counts; missing fields fall back to 0."""
    usage = getattr(response, "usage", None)
    if usage is None:
        return {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_input_tokens": 0,
            "cache_creation_input_tokens": 0,
        }
    return {
        "input_tokens": int(getattr(usage, "input_tokens", 0) or 0),
        "output_tokens": int(getattr(usage, "output_tokens", 0) or 0),
        "cache_read_input_tokens": int(getattr(usage, "cache_read_input_tokens", 0) or 0),
        "cache_creation_input_tokens": int(getattr(usage, "cache_creation_input_tokens", 0) or 0),
    }
