"""Tests for the LLM-as-judge.

Uses an in-test fake Anthropic client so no real tokens are spent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from evals.judge import (
    DEFAULT_JUDGE_MODEL,
    JudgeError,
    JudgeResult,
    judge_example,
)
from evals.judges import JUDGE_VERSION
from evals.schema import EvalExample
from evals.scorers.types import PredictedReview

# -------- fixtures: fake Anthropic SDK shapes --------


@dataclass
class _FakeTextBlock:
    text: str
    type: str = "text"


@dataclass
class _FakeUsage:
    input_tokens: int = 1200
    output_tokens: int = 80
    cache_read_input_tokens: int = 800
    cache_creation_input_tokens: int = 0


@dataclass
class _FakeResponse:
    content: list[_FakeTextBlock]
    usage: _FakeUsage = field(default_factory=_FakeUsage)


class _FakeMessages:
    def __init__(self, responses: list[_FakeResponse]) -> None:
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> _FakeResponse:
        self.calls.append(kwargs)
        return self._responses.pop(0)


class _FakeClient:
    def __init__(self, responses: list[_FakeResponse]) -> None:
        self.messages = _FakeMessages(responses)


def _example() -> EvalExample:
    return EvalExample.model_validate(
        {
            "id": "seed-test",
            "pr_url": None,
            "pr_title": "Fix null deref",
            "pr_diff": "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n",
            "ground_truth": {
                "findings": [
                    {
                        "category": "bug",
                        "severity": "major",
                        "summary": "Dropped None-check causes AttributeError.",
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
    )


def _prediction() -> PredictedReview:
    return PredictedReview.model_validate(
        {
            "summary": "Reviewer flagged the missing None-check.",
            "confidence": "high",
            "findings": [
                {
                    "category": "bug",
                    "severity": "major",
                    "summary": "PR removes the None check causing AttributeError",
                    "locationHint": "x:1",
                }
            ],
        }
    )


# -------- the tests --------


class TestJudgeHappyPath:
    def test_parses_score_and_rationale(self) -> None:
        client = _FakeClient(
            [
                _FakeResponse(
                    content=[
                        _FakeTextBlock(text='{"score": 0.9, "rationale": "Correct and clear."}')
                    ]
                )
            ]
        )
        result = judge_example(client, example=_example(), prediction=_prediction())
        assert isinstance(result, JudgeResult)
        assert result.score == pytest.approx(0.9)
        assert result.rationale == "Correct and clear."
        assert result.judge_version == JUDGE_VERSION
        assert result.model == DEFAULT_JUDGE_MODEL
        assert result.input_tokens == 1200
        assert result.output_tokens == 80
        assert result.cache_read_tokens == 800

    def test_tolerates_fenced_json(self) -> None:
        client = _FakeClient(
            [
                _FakeResponse(
                    content=[
                        _FakeTextBlock(
                            text=(
                                "Here is my judgment:\n```json\n"
                                '{"score": 0.7, "rationale": "Right idea, fuzzy."}\n'
                                "```"
                            )
                        )
                    ]
                )
            ]
        )
        result = judge_example(client, example=_example(), prediction=_prediction())
        assert result.score == pytest.approx(0.7)

    def test_zero_score_is_valid(self) -> None:
        client = _FakeClient(
            [
                _FakeResponse(
                    content=[_FakeTextBlock(text='{"score": 0.0, "rationale": "Missed it."}')]
                )
            ]
        )
        result = judge_example(client, example=_example(), prediction=_prediction())
        assert result.score == 0.0


class TestJudgeRequestShape:
    def test_sends_cached_system_prompt(self) -> None:
        client = _FakeClient(
            [_FakeResponse(content=[_FakeTextBlock(text='{"score": 1.0, "rationale": "ok"}')])]
        )
        judge_example(client, example=_example(), prediction=_prediction())
        call = client.messages.calls[0]
        assert isinstance(call["system"], list)
        block = call["system"][0]
        assert block["type"] == "text"
        assert block["cache_control"] == {"type": "ephemeral"}
        assert "rubric" in block["text"].lower() or "score" in block["text"].lower()

    def test_user_message_embeds_diff_and_findings(self) -> None:
        client = _FakeClient(
            [_FakeResponse(content=[_FakeTextBlock(text='{"score": 0.5, "rationale": "x"}')])]
        )
        ex = _example()
        pred = _prediction()
        judge_example(client, example=ex, prediction=pred)
        call = client.messages.calls[0]
        user_msg = call["messages"][0]["content"]
        assert ex.pr_title in user_msg
        assert "BEGIN DIFF" in user_msg
        assert "GROUND TRUTH FINDINGS" in user_msg
        assert "REVIEWER FINDINGS" in user_msg
        assert pred.findings[0].summary in user_msg

    def test_honors_custom_model_and_max_tokens(self) -> None:
        client = _FakeClient(
            [_FakeResponse(content=[_FakeTextBlock(text='{"score": 1.0, "rationale": "ok"}')])]
        )
        result = judge_example(
            client,
            example=_example(),
            prediction=_prediction(),
            model="claude-opus-4-7",
            max_tokens=2048,
        )
        call = client.messages.calls[0]
        assert call["model"] == "claude-opus-4-7"
        assert call["max_tokens"] == 2048
        assert result.model == "claude-opus-4-7"


class TestJudgeErrorPaths:
    def test_raises_on_invalid_json(self) -> None:
        client = _FakeClient([_FakeResponse(content=[_FakeTextBlock(text="totally not json")])])
        with pytest.raises(JudgeError, match="not valid JSON"):
            judge_example(client, example=_example(), prediction=_prediction())

    def test_raises_on_score_out_of_range(self) -> None:
        client = _FakeClient(
            [_FakeResponse(content=[_FakeTextBlock(text='{"score": 1.5, "rationale": "x"}')])]
        )
        with pytest.raises(JudgeError, match="schema validation"):
            judge_example(client, example=_example(), prediction=_prediction())

    def test_raises_on_missing_rationale(self) -> None:
        client = _FakeClient([_FakeResponse(content=[_FakeTextBlock(text='{"score": 0.5}')])])
        with pytest.raises(JudgeError, match="schema validation"):
            judge_example(client, example=_example(), prediction=_prediction())

    def test_raises_on_empty_content(self) -> None:
        client = _FakeClient([_FakeResponse(content=[])])
        with pytest.raises(JudgeError, match="no content"):
            judge_example(client, example=_example(), prediction=_prediction())

    def test_raises_when_no_text_block(self) -> None:
        @dataclass
        class _ToolBlock:
            type: str = "tool_use"

        client = _FakeClient([_FakeResponse(content=[_ToolBlock()])])  # type: ignore[list-item]
        with pytest.raises(JudgeError, match="No non-empty text block"):
            judge_example(client, example=_example(), prediction=_prediction())


class TestJudgeUsage:
    def test_missing_usage_fields_default_to_zero(self) -> None:
        @dataclass
        class _PartialUsage:
            input_tokens: int = 100
            # no output_tokens, no cache fields

        client = _FakeClient(
            [
                _FakeResponse(
                    content=[_FakeTextBlock(text='{"score": 0.5, "rationale": "x"}')],
                    usage=_PartialUsage(),  # type: ignore[arg-type]
                )
            ]
        )
        result = judge_example(client, example=_example(), prediction=_prediction())
        assert result.input_tokens == 100
        assert result.output_tokens == 0
        assert result.cache_read_tokens == 0
