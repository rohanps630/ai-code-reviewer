"""Voyage embeddings adapter tests.

We never hit the real Voyage API. `httpx.MockTransport` lets us define
deterministic responses per request; the embedder accepts an injected
`httpx.Client` so the tests can swap the transport without touching
the network or monkey-patching.
"""

from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest

from indexer.embeddings import EmbeddingError, Vector, VoyageEmbedder

# A 1024-dim vector that's cheap to construct in tests.
_VEC = [0.1] * 1024


def _make_embedder(
    handler: Callable[[httpx.Request], httpx.Response], **kwargs: object
) -> VoyageEmbedder:
    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    return VoyageEmbedder(api_key="test-key", client=client, **kwargs)  # type: ignore[arg-type]


def _voyage_ok(n: int) -> dict[str, object]:
    return {"data": [{"embedding": list(_VEC)} for _ in range(n)]}


# ────────────────────────────────────────────────────────────────────
# Happy paths
# ────────────────────────────────────────────────────────────────────


def test_embed_documents_returns_one_vector_per_input() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        return httpx.Response(200, json=_voyage_ok(len(body["input"])))

    embedder = _make_embedder(handler)
    vectors: list[Vector] = embedder.embed_documents(["a", "b", "c"])
    assert len(vectors) == 3
    assert all(len(v) == 1024 for v in vectors)


def test_embed_query_returns_a_single_vector() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["input_type"] == "query"
        assert body["input"] == ["how does auth work?"]
        return httpx.Response(200, json=_voyage_ok(1))

    embedder = _make_embedder(handler)
    vec = embedder.embed_query("how does auth work?")
    assert len(vec) == 1024


def test_documents_use_document_input_type() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body["input_type"])
        return httpx.Response(200, json=_voyage_ok(len(body["input"])))

    embedder = _make_embedder(handler)
    embedder.embed_documents(["a"])
    assert seen == ["document"]


def test_empty_input_returns_empty_list() -> None:
    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        raise AssertionError("Should not make HTTP request for empty input")

    embedder = _make_embedder(handler)
    assert embedder.embed_documents([]) == []


# ────────────────────────────────────────────────────────────────────
# Batching
# ────────────────────────────────────────────────────────────────────


def test_inputs_are_split_into_voyage_sized_batches() -> None:
    batch_sizes: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        batch_sizes.append(len(body["input"]))
        return httpx.Response(200, json=_voyage_ok(len(body["input"])))

    # 250 inputs with batch_size 128 → batches of 128 + 122
    embedder = _make_embedder(handler, batch_size=128)
    vectors = embedder.embed_documents(["x"] * 250)
    assert batch_sizes == [128, 122]
    assert len(vectors) == 250


def test_smaller_batch_size_is_honored() -> None:
    batch_sizes: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        batch_sizes.append(len(body["input"]))
        return httpx.Response(200, json=_voyage_ok(len(body["input"])))

    embedder = _make_embedder(handler, batch_size=2)
    embedder.embed_documents(["a", "b", "c", "d", "e"])
    assert batch_sizes == [2, 2, 1]


# ────────────────────────────────────────────────────────────────────
# Retry behavior
# ────────────────────────────────────────────────────────────────────


def test_retries_on_transient_5xx_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    # Skip the actual sleep waits so the test finishes fast.
    import tenacity

    monkeypatch.setattr(tenacity.nap, "sleep", lambda _seconds: None)

    attempt = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempt["n"] += 1
        if attempt["n"] < 3:
            return httpx.Response(503, text="upstream busy")
        body = json.loads(request.content)
        return httpx.Response(200, json=_voyage_ok(len(body["input"])))

    embedder = _make_embedder(handler)
    vectors = embedder.embed_documents(["a", "b"])
    assert attempt["n"] == 3
    assert len(vectors) == 2


def test_retries_on_429_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    import tenacity

    monkeypatch.setattr(tenacity.nap, "sleep", lambda _seconds: None)

    attempt = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempt["n"] += 1
        if attempt["n"] == 1:
            return httpx.Response(429, text="rate limited")
        return httpx.Response(200, json=_voyage_ok(1))

    embedder = _make_embedder(handler)
    embedder.embed_query("hello")
    assert attempt["n"] == 2


def test_does_not_retry_on_4xx_other_than_429(monkeypatch: pytest.MonkeyPatch) -> None:
    import tenacity

    monkeypatch.setattr(tenacity.nap, "sleep", lambda _seconds: None)

    attempt = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        attempt["n"] += 1
        return httpx.Response(401, text="bad key")

    embedder = _make_embedder(handler)
    with pytest.raises(EmbeddingError):
        embedder.embed_query("hello")
    assert attempt["n"] == 1


def test_raises_after_retries_exhausted(monkeypatch: pytest.MonkeyPatch) -> None:
    import tenacity

    monkeypatch.setattr(tenacity.nap, "sleep", lambda _seconds: None)

    attempt = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        attempt["n"] += 1
        return httpx.Response(503, text="busy")

    embedder = _make_embedder(handler)
    with pytest.raises(EmbeddingError):
        embedder.embed_query("hello")
    # 5 attempts per the @retry decorator
    assert attempt["n"] == 5


# ────────────────────────────────────────────────────────────────────
# Response-shape failures
# ────────────────────────────────────────────────────────────────────


def test_missing_data_array_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    import tenacity

    monkeypatch.setattr(tenacity.nap, "sleep", lambda _seconds: None)

    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        return httpx.Response(200, json={"unexpected": "shape"})

    embedder = _make_embedder(handler)
    with pytest.raises(EmbeddingError):
        embedder.embed_query("hello")


def test_wrong_vector_count_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    import tenacity

    monkeypatch.setattr(tenacity.nap, "sleep", lambda _seconds: None)

    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        # Asked for 3, got 2 → adapter rejects.
        return httpx.Response(200, json=_voyage_ok(2))

    embedder = _make_embedder(handler)
    with pytest.raises(EmbeddingError):
        embedder.embed_documents(["a", "b", "c"])


# ────────────────────────────────────────────────────────────────────
# Construction
# ────────────────────────────────────────────────────────────────────


def test_empty_api_key_rejected() -> None:
    with pytest.raises(ValueError):
        VoyageEmbedder(api_key="")
