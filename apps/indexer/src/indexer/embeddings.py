"""Voyage embeddings adapter.

Phase 2.3 — turns chunk text into the 1024-dim vectors that go into
the `chunks.embedding` column.

Why Voyage:
  - `voyage-code-3` beats general-purpose embeddings on code retrieval
    benchmarks (see ADR-001). The choice is locked in for the project.

What this module owns:
  - One client class (`VoyageEmbedder`) with two methods:
        embed_documents(texts) -> list[Vector]    # for indexing
        embed_query(query)     -> Vector          # for search-time
    The two flavors send different `input_type` to Voyage, which
    asymmetrically tunes the two ends of the dot product.
  - Batching to Voyage's per-request limit (128 inputs).
  - Retry with exponential backoff on transient errors (429 / 5xx /
    network). Non-retryable errors (auth, bad request) raise
    immediately as `EmbeddingError`.

What this module does NOT own:
  - Persistence (writing vectors into Postgres) — separate concern.
  - Concurrency — sync API for simplicity; callers can parallelize
    at a higher level if they need to.

Testability:
  - The constructor accepts an optional `httpx.Client` so tests can
    inject one backed by `httpx.MockTransport` and avoid real HTTP.
"""

from __future__ import annotations

from typing import Literal, cast

import httpx
from tenacity import (
    RetryError,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from shared.config import load_settings

# Public type alias. Vectors are plain lists of floats — keeping the type
# simple makes downstream serialization trivial.
Vector = list[float]

# Voyage API constants.
_API_URL = "https://api.voyageai.com/v1/embeddings"
_DEFAULT_MODEL = "voyage-code-3"
_BATCH_SIZE = 128  # Voyage's max inputs per request as of 2026-05
_DEFAULT_TIMEOUT_SECONDS = 30.0

# Error codes we should retry. 429 and 5xx are transient; 4xx (except
# 429) almost always means we sent something Voyage can't accept and
# retrying won't help.
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class EmbeddingError(RuntimeError):
    """Raised when Voyage returns a non-retryable error (or retries exhausted)."""


class _RetryableHTTPStatusError(RuntimeError):
    """Internal: signals tenacity that this attempt should be retried."""


class VoyageEmbedder:
    """Synchronous Voyage embeddings client."""

    def __init__(
        self,
        api_key: str,
        *,
        model: str = _DEFAULT_MODEL,
        batch_size: int = _BATCH_SIZE,
        timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS,
        client: httpx.Client | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("VoyageEmbedder requires a non-empty api_key")
        self._api_key = api_key
        self._model = model
        self._batch_size = batch_size
        self._owned_client = client is None
        self._client = client or httpx.Client(timeout=timeout_seconds)

    def close(self) -> None:
        """Release the underlying httpx.Client if we own it."""
        if self._owned_client:
            self._client.close()

    def __enter__(self) -> VoyageEmbedder:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # ── public ──────────────────────────────────────────────────────────

    def embed_documents(self, texts: list[str]) -> list[Vector]:
        """Embed a list of indexable chunks. Returns vectors in the same order."""
        return self._embed_batched(texts, input_type="document")

    def embed_query(self, query: str) -> Vector:
        """Embed a single search query. Returns one vector."""
        vectors = self._embed_batched([query], input_type="query")
        # _embed_batched guarantees one vector per input
        return vectors[0]

    # ── internals ───────────────────────────────────────────────────────

    def _embed_batched(
        self, texts: list[str], *, input_type: Literal["document", "query"]
    ) -> list[Vector]:
        if not texts:
            return []
        out: list[Vector] = []
        for start in range(0, len(texts), self._batch_size):
            batch = texts[start : start + self._batch_size]
            out.extend(self._embed_one_request(batch, input_type=input_type))
        return out

    def _embed_one_request(
        self, batch: list[str], *, input_type: Literal["document", "query"]
    ) -> list[Vector]:
        try:
            return self._request_with_retry(batch, input_type)
        except RetryError as err:
            # tenacity wraps the final failure; surface the underlying cause.
            cause = err.last_attempt.exception() if err.last_attempt else None
            raise EmbeddingError(f"Voyage request failed after retries: {cause}") from cause

    @retry(
        retry=retry_if_exception_type((httpx.HTTPError, _RetryableHTTPStatusError)),
        wait=wait_exponential(multiplier=0.5, min=0.5, max=8.0),
        stop=stop_after_attempt(5),
        reraise=False,
    )
    def _request_with_retry(
        self, batch: list[str], input_type: Literal["document", "query"]
    ) -> list[Vector]:
        response = self._client.post(
            _API_URL,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            json={
                "input": batch,
                "model": self._model,
                "input_type": input_type,
            },
        )

        if response.status_code in _RETRYABLE_STATUS:
            raise _RetryableHTTPStatusError(
                f"voyage returned {response.status_code}: {response.text[:200]}"
            )
        if response.status_code >= 400:
            # Non-retryable client/server error: stop immediately.
            raise EmbeddingError(f"voyage returned {response.status_code}: {response.text[:200]}")

        body = response.json()
        data = body.get("data")
        if not isinstance(data, list):
            raise EmbeddingError(f"voyage response missing 'data' array: {body!r}")

        vectors: list[Vector] = []
        for item in data:
            emb = item.get("embedding")
            if not isinstance(emb, list):
                raise EmbeddingError(f"voyage response item missing 'embedding': {item!r}")
            vectors.append(cast(Vector, emb))

        if len(vectors) != len(batch):
            raise EmbeddingError(f"voyage returned {len(vectors)} vectors for {len(batch)} inputs")
        return vectors


def voyage_embedder_from_env(**kwargs: object) -> VoyageEmbedder:
    """Construct a VoyageEmbedder using credentials from `shared.config`.

    Raises EmbeddingError if VOYAGE_API_KEY isn't configured — fail loud
    rather than silently produce empty vectors.
    """
    settings = load_settings()
    if not settings.voyage_api_key:
        raise EmbeddingError("VOYAGE_API_KEY is not set. Configure it in apps/indexer/.env.")
    return VoyageEmbedder(api_key=settings.voyage_api_key, **kwargs)  # type: ignore[arg-type]
