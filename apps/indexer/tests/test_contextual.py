"""Contextual prefix generator tests.

We never hit the real Anthropic API. The Contextualizer takes an
Anthropic client in the constructor; tests pass a `MagicMock` with
a `messages.create` attribute and inspect what we asked Claude.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest
from anthropic import APIStatusError

from indexer.contextual import ContextualizationError, Contextualizer


def _claude_response(text: str) -> SimpleNamespace:
    """Minimal stand-in for an Anthropic Message response object."""
    return SimpleNamespace(content=[SimpleNamespace(text=text, type="text")])


def _api_status_error(status: int, message: str = "boom") -> APIStatusError:
    """Build an APIStatusError the SDK would actually raise on a non-2xx."""
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx.Response(status, request=request, text=message)
    return APIStatusError(message=message, response=response, body=None)


# ────────────────────────────────────────────────────────────────────
# Happy path
# ────────────────────────────────────────────────────────────────────


def test_contextualize_returns_trimmed_text() -> None:
    client = MagicMock()
    client.messages.create.return_value = _claude_response(
        "  The `login` function in src/auth/login.ts.  \n"
    )

    ctx = Contextualizer(client=client)
    result = ctx.contextualize(
        chunk_text="export function login() { ... }",
        document_text="...whole file...",
        file_path="src/auth/login.ts",
    )

    assert result == "The `login` function in src/auth/login.ts."


def test_contextualize_sends_cache_control_on_document_block() -> None:
    client = MagicMock()
    client.messages.create.return_value = _claude_response("context")

    ctx = Contextualizer(client=client)
    ctx.contextualize(
        chunk_text="snippet",
        document_text="document body",
        file_path="src/foo.ts",
    )

    kwargs = client.messages.create.call_args.kwargs
    blocks = kwargs["messages"][0]["content"]
    # The first user-content block carries the document and cache_control.
    assert blocks[0]["cache_control"] == {"type": "ephemeral"}
    assert "<document>" in blocks[0]["text"]
    assert "document body" in blocks[0]["text"]
    # The second block is the chunk + instructions; should NOT be cached.
    assert "cache_control" not in blocks[1]


def test_contextualize_uses_configured_model_and_max_tokens() -> None:
    client = MagicMock()
    client.messages.create.return_value = _claude_response("ctx")

    ctx = Contextualizer(client=client, model="claude-haiku-test", max_tokens=42)
    ctx.contextualize(
        chunk_text="x",
        document_text="y",
        file_path="z.py",
    )

    kwargs = client.messages.create.call_args.kwargs
    assert kwargs["model"] == "claude-haiku-test"
    assert kwargs["max_tokens"] == 42


def test_contextualize_includes_chunk_and_file_path_in_request() -> None:
    client = MagicMock()
    client.messages.create.return_value = _claude_response("ctx")

    ctx = Contextualizer(client=client)
    ctx.contextualize(
        chunk_text="export function login() {}",
        document_text="...",
        file_path="src/auth/login.ts",
    )

    kwargs = client.messages.create.call_args.kwargs
    flat = " ".join(block["text"] for block in kwargs["messages"][0]["content"])
    assert "src/auth/login.ts" in flat
    assert "export function login()" in flat


# ────────────────────────────────────────────────────────────────────
# Validation
# ────────────────────────────────────────────────────────────────────


def test_empty_chunk_text_rejected() -> None:
    client = MagicMock()
    ctx = Contextualizer(client=client)
    with pytest.raises(ValueError):
        ctx.contextualize(chunk_text="   ", document_text="d", file_path="p")


# ────────────────────────────────────────────────────────────────────
# Retry behavior
# ────────────────────────────────────────────────────────────────────


def test_retries_on_overloaded_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    import tenacity

    monkeypatch.setattr(tenacity.nap, "sleep", lambda _seconds: None)

    client = MagicMock()
    client.messages.create.side_effect = [
        _api_status_error(529, "overloaded"),
        _api_status_error(529, "overloaded"),
        _claude_response("ctx"),
    ]

    ctx = Contextualizer(client=client)
    assert ctx.contextualize(chunk_text="x", document_text="y", file_path="z.py") == "ctx"
    assert client.messages.create.call_count == 3


def test_retries_on_rate_limit_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    import tenacity

    monkeypatch.setattr(tenacity.nap, "sleep", lambda _seconds: None)

    client = MagicMock()
    client.messages.create.side_effect = [
        _api_status_error(429, "rate limited"),
        _claude_response("ctx"),
    ]

    ctx = Contextualizer(client=client)
    ctx.contextualize(chunk_text="x", document_text="y", file_path="z.py")
    assert client.messages.create.call_count == 2


def test_does_not_retry_on_auth_error() -> None:
    client = MagicMock()
    client.messages.create.side_effect = _api_status_error(401, "bad key")

    ctx = Contextualizer(client=client)
    with pytest.raises(ContextualizationError):
        ctx.contextualize(chunk_text="x", document_text="y", file_path="z.py")
    assert client.messages.create.call_count == 1


def test_retries_exhausted_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    import tenacity

    monkeypatch.setattr(tenacity.nap, "sleep", lambda _seconds: None)

    client = MagicMock()
    client.messages.create.side_effect = _api_status_error(503, "busy")

    ctx = Contextualizer(client=client)
    with pytest.raises(ContextualizationError):
        ctx.contextualize(chunk_text="x", document_text="y", file_path="z.py")
    # 5 attempts from the @retry decorator
    assert client.messages.create.call_count == 5


# ────────────────────────────────────────────────────────────────────
# Response-shape failures
# ────────────────────────────────────────────────────────────────────


def test_empty_content_blocks_raises() -> None:
    client = MagicMock()
    client.messages.create.return_value = SimpleNamespace(content=[])

    ctx = Contextualizer(client=client)
    with pytest.raises(ContextualizationError):
        ctx.contextualize(chunk_text="x", document_text="y", file_path="z.py")


def test_non_text_block_raises() -> None:
    client = MagicMock()
    client.messages.create.return_value = SimpleNamespace(
        content=[SimpleNamespace(text=None, type="tool_use")]
    )

    ctx = Contextualizer(client=client)
    with pytest.raises(ContextualizationError):
        ctx.contextualize(chunk_text="x", document_text="y", file_path="z.py")
