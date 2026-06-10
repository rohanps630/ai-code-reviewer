"""Full indexer pipeline: clone → chunk → contextualize → embed → persist.

Usage:
    python -m indexer.pipeline <repo-url>

The pipeline is the main orchestrator. It ties together all the
indexer modules (chunking, contextual, embeddings, db) into a single
`index_repo()` function that takes a GitHub URL and indexes it into
Postgres.

Graceful degradation:
  - Without ANTHROPIC_API_KEY: skip contextualization, embed raw chunks.
  - Without VOYAGE_API_KEY: store chunks without embeddings (prints warning).
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from indexer.chunking import chunk_file
from indexer.db import IndexerDB
from indexer.languages import is_supported
from indexer.models import FileChunks
from shared.config import Settings, load_settings


def index_repo(
    repo_url: str,
    *,
    settings: Settings | None = None,
    db: IndexerDB | None = None,
) -> dict:
    """Index a single repo end-to-end. Returns a stats dict."""
    cfg = settings or load_settings()
    own_db = db is None
    database = db or IndexerDB(cfg.database_url)

    stats = {
        "repo_url": repo_url,
        "files_scanned": 0,
        "files_chunked": 0,
        "chunks_total": 0,
        "chunks_embedded": 0,
        "skipped_unchanged": 0,
    }

    try:
        # Look up the repo in DB
        repo_row = database.get_repo_by_url(repo_url)
        if not repo_row:
            print(f"[indexer] Repo not found in DB: {repo_url}", file=sys.stderr)
            print("[indexer] Register it via POST /api/repos first.", file=sys.stderr)
            return stats

        repo_id = str(repo_row["id"])
        database.update_repo_status(repo_id, status="indexing")

        # Clone to a temp directory
        tmp_dir = tempfile.mkdtemp(prefix="acr-index-")
        try:
            head_sha = _clone_repo(repo_url, tmp_dir)
            repo_root = Path(tmp_dir)

            # Walk and chunk files
            all_file_chunks: list[FileChunks] = []
            for source_file in _walk_supported_files(repo_root):
                stats["files_scanned"] += 1
                fc = chunk_file(source_file, repo_root=repo_root)
                if fc is not None and len(fc.chunks) > 0:
                    # Skip files whose content hasn't changed
                    existing_hash = database.get_document_content_hash(repo_id, fc.path)
                    if existing_hash == fc.content_hash:
                        stats["skipped_unchanged"] += 1
                        continue
                    all_file_chunks.append(fc)
                    stats["files_chunked"] += 1
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

        # Contextualize (if API key available)
        contextualizer = _build_contextualizer(cfg)
        if contextualizer:
            _apply_contextualization(all_file_chunks, contextualizer)

        # Embed (if API key available)
        embedder = _build_embedder(cfg)
        embedded_chunks = _embed_all_chunks(all_file_chunks, embedder)
        stats["chunks_embedded"] = sum(
            1 for embs in embedded_chunks.values() for e in embs if e is not None
        )

        # Persist
        for fc in all_file_chunks:
            doc_id = database.upsert_document(
                repo_id=repo_id,
                path=fc.path,
                language=fc.language,
                content_hash=fc.content_hash,
                size_bytes=fc.size_bytes,
            )
            chunk_embs = embedded_chunks.get(fc.path, [None] * len(fc.chunks))
            inserted = database.replace_chunks(
                document_id=doc_id,
                repo_id=repo_id,
                chunks=list(fc.chunks),
                embeddings=chunk_embs,
            )
            stats["chunks_total"] += inserted

        # Update repo status
        database.update_repo_status(repo_id, status="indexed", last_indexed_commit=head_sha)
        print(f"[indexer] Done: {stats}", file=sys.stderr)

    except Exception as exc:
        # Mark repo as failed
        if repo_row:
            try:
                database.update_repo_status(str(repo_row["id"]), status="failed")
            except Exception:  # noqa: S110
                pass  # Best effort — the original error is re-raised below
        raise RuntimeError(f"Indexing failed for {repo_url}: {exc}") from exc

    finally:
        if own_db:
            database.close()

    return stats


# ── helpers ────────────────────────────────────────────────────────


def _clone_repo(url: str, dest: str) -> str:
    """Shallow-clone a GitHub repo. Returns HEAD sha."""
    subprocess.run(  # noqa: S603
        ["git", "clone", "--depth", "1", url, dest],  # noqa: S607
        check=True,
        capture_output=True,
        text=True,
    )
    result = subprocess.run(  # noqa: S603
        ["git", "rev-parse", "HEAD"],  # noqa: S607
        cwd=dest,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _walk_supported_files(root: Path) -> list[Path]:
    """Walk root for files the indexer can chunk, skipping hidden dirs."""
    files: list[Path] = []
    for path in sorted(root.rglob("*")):
        if path.is_dir():
            continue
        # Skip hidden directories (e.g. .git)
        if any(part.startswith(".") for part in path.relative_to(root).parts):
            continue
        # Skip node_modules, vendor, dist, etc.
        rel = path.relative_to(root).as_posix()
        if any(seg in rel for seg in ("node_modules/", "vendor/", "dist/", "__pycache__/")):
            continue
        if is_supported(path):
            files.append(path)
    return files


def _build_contextualizer(cfg: Settings):
    """Build a Contextualizer if ANTHROPIC_API_KEY is available."""
    if not cfg.anthropic_api_key:
        print("[indexer] ANTHROPIC_API_KEY not set — skipping contextualization.", file=sys.stderr)
        return None
    try:
        from indexer.contextual import contextualizer_from_env

        return contextualizer_from_env()
    except Exception as exc:
        print(f"[indexer] Failed to build contextualizer: {exc}", file=sys.stderr)
        return None


def _apply_contextualization(all_file_chunks: list[FileChunks], contextualizer) -> None:
    """Apply contextual prefixes to all chunks (mutates content_with_context)."""
    for fc in all_file_chunks:
        # Read full file content for context (chunks already have it in memory)
        full_text = "\n".join(c.content for c in fc.chunks)
        for chunk in fc.chunks:
            try:
                prefix = contextualizer.contextualize(
                    chunk_text=chunk.content,
                    document_text=full_text,
                    file_path=fc.path,
                )
                # Pydantic frozen model — create a new instance
                object.__setattr__(chunk, "content_with_context", f"{prefix}\n\n{chunk.content}")
            except Exception as exc:
                print(
                    f"[indexer] Contextualization failed for {fc.path}:{chunk.start_line}: {exc}",
                    file=sys.stderr,
                )
                # Fall back to raw content (already the default)


def _build_embedder(cfg: Settings):
    """Build a VoyageEmbedder if VOYAGE_API_KEY is available."""
    if not cfg.voyage_api_key:
        print(
            "[indexer] VOYAGE_API_KEY not set — chunks will be stored without embeddings.",
            file=sys.stderr,
        )
        return None
    try:
        from indexer.embeddings import voyage_embedder_from_env

        return voyage_embedder_from_env()
    except Exception as exc:
        print(f"[indexer] Failed to build embedder: {exc}", file=sys.stderr)
        return None


def _embed_all_chunks(
    all_file_chunks: list[FileChunks],
    embedder,
) -> dict[str, list]:
    """Embed all chunks. Returns {path: [vector|None, ...]}."""
    result: dict[str, list] = {}
    if not embedder:
        for fc in all_file_chunks:
            result[fc.path] = [None] * len(fc.chunks)
        return result

    for fc in all_file_chunks:
        texts = [c.content_with_context for c in fc.chunks]
        try:
            vectors = embedder.embed_documents(texts)
            result[fc.path] = vectors
        except Exception as exc:
            print(f"[indexer] Embedding failed for {fc.path}: {exc}", file=sys.stderr)
            result[fc.path] = [None] * len(fc.chunks)

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m indexer.pipeline <repo-url>", file=sys.stderr)
        sys.exit(1)
    index_repo(sys.argv[1])
