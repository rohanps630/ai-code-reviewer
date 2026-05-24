"""Tests for the Anthropic pricing table."""

from __future__ import annotations

import pytest

from evals.pricing import anthropic_cost_usd, known_models


def test_known_models_include_sonnet_and_opus() -> None:
    models = known_models()
    assert "claude-sonnet-4-5" in models
    assert "claude-opus-4-7" in models


def test_sonnet_cost_basic() -> None:
    # 1M input + 100k output @ sonnet 4.5 → $3 + $1.5 = $4.5
    cost = anthropic_cost_usd("claude-sonnet-4-5", input_tokens=1_000_000, output_tokens=100_000)
    assert cost == pytest.approx(4.5)


def test_cache_read_discounted() -> None:
    # 1M cache_read tokens @ sonnet 4.5 = $0.30 (1/10 of input)
    cost = anthropic_cost_usd(
        "claude-sonnet-4-5",
        input_tokens=0,
        output_tokens=0,
        cache_read_tokens=1_000_000,
    )
    assert cost == pytest.approx(0.30)


def test_cache_write_premium() -> None:
    cost = anthropic_cost_usd(
        "claude-sonnet-4-5",
        input_tokens=0,
        output_tokens=0,
        cache_creation_tokens=1_000_000,
    )
    assert cost == pytest.approx(3.75)


def test_unknown_model_zero() -> None:
    assert (
        anthropic_cost_usd(
            "claude-pizza-9000",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
        )
        == 0.0
    )
