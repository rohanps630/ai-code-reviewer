"""Anthropic price table for cost attribution.

USD per million tokens. This is a static snapshot — Anthropic moves
pricing periodically and the eval harness has no live fetch. When
pricing changes, update this table and re-run with the latest values.

Unknown model names return $0.00 so a typo'd run doesn't crash; check
the run summary's total_cost_usd against expectations.
"""

from __future__ import annotations

_PRICES: dict[str, dict[str, float]] = {
    "claude-haiku-4-5": {
        "input": 1.00,
        "output": 5.00,
        "cache_read": 0.10,
        "cache_write": 1.25,
    },
    "claude-sonnet-4-5": {
        "input": 3.00,
        "output": 15.00,
        "cache_read": 0.30,
        "cache_write": 3.75,
    },
    "claude-sonnet-4-6": {
        "input": 3.00,
        "output": 15.00,
        "cache_read": 0.30,
        "cache_write": 3.75,
    },
    "claude-opus-4-7": {
        "input": 15.00,
        "output": 75.00,
        "cache_read": 1.50,
        "cache_write": 18.75,
    },
}


def anthropic_cost_usd(
    model: str,
    *,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_creation_tokens: int = 0,
) -> float:
    """Approximate USD cost from token counters. Unknown models → 0.0."""
    prices = _PRICES.get(model)
    if prices is None:
        return 0.0
    return (
        (input_tokens / 1_000_000) * prices["input"]
        + (output_tokens / 1_000_000) * prices["output"]
        + (cache_read_tokens / 1_000_000) * prices["cache_read"]
        + (cache_creation_tokens / 1_000_000) * prices["cache_write"]
    )


def known_models() -> tuple[str, ...]:
    return tuple(_PRICES.keys())
