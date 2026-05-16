"""Pydantic models that map cleanly onto the `chunks` table in @acr/db.

These are the indexer's internal representation. The persistence layer
(landing in a later Phase 2 task) is responsible for translating these
into INSERT statements; the chunker only emits them.

Mirrors `packages/db/src/schema/chunks.ts`. If you add a field here,
add the matching column there and bump a migration.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SymbolKind = Literal["function", "class", "method", "module", "block"]


class Chunk(BaseModel):
    """One AST-aware slice of a source file, the unit of retrieval."""

    model_config = ConfigDict(frozen=True)

    # Position within the document
    chunk_index: int = Field(..., ge=0, description="0-based ordering within the document")
    start_line: int = Field(..., ge=1, description="1-based inclusive start line")
    end_line: int = Field(..., ge=1, description="1-based inclusive end line")

    # Content
    content: str = Field(..., min_length=1, description="Raw chunk source")
    content_with_context: str = Field(
        ...,
        min_length=1,
        description=(
            "Chunk source with optional contextual prefix (file path, scope hints). "
            "This is what gets embedded; `content` is what gets shown."
        ),
    )

    # AST metadata — present when the chunk was extracted from a recognizable node
    symbol_name: str | None = Field(default=None, description="e.g. function/class name")
    symbol_kind: SymbolKind | None = Field(default=None)

    # Cache key — sha256 of `content`
    content_hash: str = Field(..., min_length=64, max_length=64)


class FileChunks(BaseModel):
    """A document and its chunks. The indexer pipeline emits one per file."""

    model_config = ConfigDict(frozen=True)

    path: str = Field(..., description="Repo-relative POSIX path, e.g. src/auth/login.ts")
    language: str = Field(..., description="tree-sitter grammar name")
    content_hash: str = Field(..., min_length=64, max_length=64, description="sha256 of file")
    size_bytes: int = Field(..., ge=0)
    chunks: tuple[Chunk, ...] = Field(default_factory=tuple)
