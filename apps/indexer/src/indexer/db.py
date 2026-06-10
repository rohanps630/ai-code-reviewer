"""Postgres persistence layer for the indexer pipeline.

Writes documents + chunks to the database, matching the Drizzle
schema defined in `packages/db/src/schema/`. Uses psycopg (v3)
because the indexer is a batch script, not a long-running server,
and sync I/O keeps the code simple.

Idempotent re-indexing: `upsert_document` uses INSERT ... ON CONFLICT
(repo_id, path) to update existing rows. `upsert_chunks` replaces
all chunks for a document in one transaction (delete + insert).
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import psycopg
from psycopg.rows import dict_row

from shared.config import load_settings

if TYPE_CHECKING:
    from indexer.embeddings import Vector
    from indexer.models import Chunk


class IndexerDB:
    """Synchronous Postgres writer for the indexer."""

    def __init__(self, dsn: str | None = None) -> None:
        if not dsn:
            settings = load_settings()
            dsn = settings.database_url
        if not dsn:
            raise ValueError("DATABASE_URL is not set. Configure it in apps/indexer/.env.")
        self._conn = psycopg.connect(dsn, row_factory=dict_row)
        self._conn.autocommit = False

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> IndexerDB:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # ── repos ──────────────────────────────────────────────────────

    def get_repo_by_url(self, url: str) -> dict | None:
        """Look up a repo row by canonical URL."""
        with self._conn.cursor() as cur:
            cur.execute("SELECT * FROM repos WHERE url = %s", (url,))
            return cur.fetchone()  # type: ignore[return-value]

    def update_repo_status(
        self,
        repo_id: str,
        *,
        status: str,
        last_indexed_commit: str | None = None,
    ) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                UPDATE repos
                SET status = %s,
                    last_indexed_commit = COALESCE(%s, last_indexed_commit),
                    last_indexed_at = CASE WHEN %s = 'indexed' THEN now() ELSE last_indexed_at END,
                    updated_at = now()
                WHERE id = %s
                """,
                (status, last_indexed_commit, status, repo_id),
            )
        self._conn.commit()

    # ── documents ──────────────────────────────────────────────────

    def upsert_document(
        self,
        *,
        repo_id: str,
        path: str,
        language: str | None,
        content_hash: str,
        size_bytes: int,
    ) -> str:
        """Insert or update a document. Returns the document ID."""
        doc_id = str(uuid.uuid4())
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO documents (
                    id, repo_id, path, language,
                    content_hash, size_bytes, indexed_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, now())
                ON CONFLICT (repo_id, path) DO UPDATE SET
                    language = EXCLUDED.language,
                    content_hash = EXCLUDED.content_hash,
                    size_bytes = EXCLUDED.size_bytes,
                    indexed_at = now(),
                    updated_at = now()
                RETURNING id
                """,
                (doc_id, repo_id, path, language, content_hash, size_bytes),
            )
            row = cur.fetchone()
        self._conn.commit()
        return str(row["id"]) if row else doc_id  # type: ignore[index]

    def get_document_content_hash(self, repo_id: str, path: str) -> str | None:
        """Return the stored content_hash for a document, or None."""
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT content_hash FROM documents WHERE repo_id = %s AND path = %s",
                (repo_id, path),
            )
            row = cur.fetchone()
        return str(row["content_hash"]) if row else None  # type: ignore[index]

    # ── chunks ─────────────────────────────────────────────────────

    def replace_chunks(
        self,
        *,
        document_id: str,
        repo_id: str,
        chunks: list[Chunk],
        embeddings: list[Vector | None],
    ) -> int:
        """Delete existing chunks for a document and insert new ones.

        Returns the number of chunks inserted.
        """
        if len(chunks) != len(embeddings):
            raise ValueError(
                f"chunks ({len(chunks)}) and embeddings "
                f"({len(embeddings)}) must have the same length"
            )
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM chunks WHERE document_id = %s", (document_id,))
            for chunk, embedding in zip(chunks, embeddings, strict=True):
                emb_literal = _vector_literal(embedding) if embedding else None
                cur.execute(
                    """
                    INSERT INTO chunks (
                        id, document_id, repo_id, chunk_index, start_line, end_line,
                        content, content_with_context, symbol_name, symbol_kind,
                        content_hash, embedding
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s::vector
                    )
                    """,
                    (
                        str(uuid.uuid4()),
                        document_id,
                        repo_id,
                        chunk.chunk_index,
                        chunk.start_line,
                        chunk.end_line,
                        chunk.content,
                        chunk.content_with_context,
                        chunk.symbol_name,
                        chunk.symbol_kind,
                        chunk.content_hash,
                        emb_literal,
                    ),
                )
        self._conn.commit()
        return len(chunks)


def _vector_literal(vec: list[float]) -> str:
    """Convert a list of floats to Postgres pgvector literal '[0.1,0.2,...]'."""
    return "[" + ",".join(str(f) for f in vec) + "]"
