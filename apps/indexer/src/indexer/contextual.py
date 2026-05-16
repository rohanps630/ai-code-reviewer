"""Contextual prefix generation (Anthropic's contextual retrieval).

Phase 2.4 — for every chunk, ask Claude Haiku for a 1–2 sentence
"what is this chunk and where does it sit in the document?" prefix.
We then prepend that prefix before embedding, which dramatically
improves recall on short snippets where the chunk alone is ambiguous
("this function does X" — but X for what? in which module?).

Cost discipline:
  - The full document goes into a `cache_control: ephemeral` content
    block, so Anthropic caches it for ~5 minutes. Per-chunk calls
    against the same document reuse the cached prefix; we pay full
    tokens once and ~10% for each follow-up. On a 1000-LOC file with
    20 chunks, that's an ~85% input-token saving vs naive calls.
  - Haiku is 4–6× cheaper than Sonnet and good enough for "one
    sentence of context."
  - max_tokens is capped at 120 — we want a one-liner, not an essay.

Failure model:
  - Transient errors (rate limit, overloaded, 5xx) retry with
    exponential backoff via tenacity.
  - Non-retryable errors (auth, bad request) raise immediately as
    `ContextualizationError`.
  - If contextualization fails for a given chunk the indexer pipeline
    should fall back to embedding the raw chunk content rather than
    blocking the whole index. This module just surfaces errors.

Testability:
  - The Contextualizer accepts an injected Anthropic client. Tests
    pass a `MagicMock` and skip the network entirely.
"""

from __future__ import annotations

from typing import cast

from anthropic import Anthropic, APIStatusError
from tenacity import (
    RetryError,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from shared.config import load_settings

# Locked-in model choice for context generation. Haiku family — cheap
# and fast, plenty smart enough for a one-sentence orientation task.
_DEFAULT_MODEL = "claude-haiku-4-5"
_DEFAULT_MAX_TOKENS = 120

_SYSTEM_PROMPT = (
    "You write short, factual orientation sentences that help a code-search "
    "system find the right snippet. Output 1-2 sentences only. Never add "
    "preamble, never use markdown, never quote the snippet."
)

# Status codes Anthropic returns that we should retry. 429 + 5xx are
# transient; auth / not-found / validation errors aren't.
_RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504, 529}


class ContextualizationError(RuntimeError):
    """Raised when Claude returns a non-retryable error (or retries exhausted)."""


class _RetryableAPIError(RuntimeError):
    """Internal: signals tenacity that this attempt should be retried."""


class Contextualizer:
    """Generates a short contextual prefix for a chunk inside a document."""

    def __init__(
        self,
        *,
        client: Anthropic,
        model: str = _DEFAULT_MODEL,
        max_tokens: int = _DEFAULT_MAX_TOKENS,
    ) -> None:
        self._client = client
        self._model = model
        self._max_tokens = max_tokens

    def contextualize(
        self,
        *,
        chunk_text: str,
        document_text: str,
        file_path: str,
    ) -> str:
        """Return a 1–2 sentence contextual prefix for `chunk_text`."""
        if not chunk_text.strip():
            raise ValueError("chunk_text must be non-empty")

        try:
            return self._call_with_retry(
                chunk_text=chunk_text,
                document_text=document_text,
                file_path=file_path,
            )
        except RetryError as err:
            cause = err.last_attempt.exception() if err.last_attempt else None
            raise ContextualizationError(
                f"Claude contextualization failed after retries: {cause}"
            ) from cause

    @retry(
        retry=retry_if_exception_type(_RetryableAPIError),
        wait=wait_exponential(multiplier=0.5, min=0.5, max=8.0),
        stop=stop_after_attempt(5),
        reraise=False,
    )
    def _call_with_retry(
        self,
        *,
        chunk_text: str,
        document_text: str,
        file_path: str,
    ) -> str:
        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=self._max_tokens,
                system=_SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": (
                                    f"File: {file_path}\n<document>\n{document_text}\n</document>"
                                ),
                                "cache_control": {"type": "ephemeral"},
                            },
                            {
                                "type": "text",
                                "text": (
                                    "Here is the snippet inside that document we want to "
                                    "situate for retrieval:\n"
                                    f"<snippet>\n{chunk_text}\n</snippet>\n\n"
                                    "Write 1-2 short sentences that situate this snippet "
                                    "in the document. Mention the symbol name, parent "
                                    "scope, and what it does. No preamble. No markdown."
                                ),
                            },
                        ],
                    }
                ],
            )
        except APIStatusError as err:
            if err.status_code in _RETRYABLE_STATUS:
                raise _RetryableAPIError(
                    f"anthropic returned {err.status_code}: {err.message}"
                ) from err
            raise ContextualizationError(
                f"anthropic returned {err.status_code}: {err.message}"
            ) from err

        # Defensive parse of the SDK's content blocks.
        blocks = getattr(response, "content", None)
        if not blocks:
            raise ContextualizationError(f"anthropic response had no content blocks: {response!r}")
        first = blocks[0]
        text = getattr(first, "text", None)
        if not isinstance(text, str) or not text.strip():
            raise ContextualizationError(f"anthropic first content block missing text: {first!r}")
        return cast(str, text).strip()


def contextualizer_from_env(**kwargs: object) -> Contextualizer:
    """Construct a Contextualizer using ANTHROPIC_API_KEY from `shared.config`.

    Fails loud with ContextualizationError if the key isn't configured.
    """
    settings = load_settings()
    if not settings.anthropic_api_key:
        raise ContextualizationError(
            "ANTHROPIC_API_KEY is not set. Configure it in apps/indexer/.env."
        )
    client = Anthropic(api_key=settings.anthropic_api_key)
    return Contextualizer(client=client, **kwargs)  # type: ignore[arg-type]
