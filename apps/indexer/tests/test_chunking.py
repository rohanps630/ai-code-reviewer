"""Chunker tests against tiny fixture files."""

from __future__ import annotations

from pathlib import Path

import pytest

from indexer.chunking import chunk_file
from indexer.models import FileChunks

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def python_chunks() -> FileChunks:
    result = chunk_file(FIXTURES / "sample.py", repo_root=FIXTURES)
    assert result is not None
    return result


@pytest.fixture
def typescript_chunks() -> FileChunks:
    result = chunk_file(FIXTURES / "sample.ts", repo_root=FIXTURES)
    assert result is not None
    return result


def test_python_file_yields_chunks_for_each_function_and_class(
    python_chunks: FileChunks,
) -> None:
    names = {c.symbol_name for c in python_chunks.chunks}
    # Top-level functions
    assert "add" in names
    assert "multiply" in names
    # Class itself, plus its methods
    assert "Calculator" in names
    assert "__init__" in names
    assert "square" in names


def test_python_chunk_kinds_are_set(python_chunks: FileChunks) -> None:
    by_name = {c.symbol_name: c for c in python_chunks.chunks}
    assert by_name["add"].symbol_kind == "function"
    assert by_name["Calculator"].symbol_kind == "class"
    # Tree-sitter Python labels methods as function_definition inside a
    # class — the chunker currently emits them as "function". That's a
    # known imperfection we'll refine in evals.
    assert by_name["square"].symbol_kind in {"function", "method"}


def test_chunk_indexes_are_sequential(python_chunks: FileChunks) -> None:
    indexes = [c.chunk_index for c in python_chunks.chunks]
    assert indexes == sorted(indexes)
    assert indexes == list(range(len(indexes)))


def test_chunk_line_ranges_are_within_file(python_chunks: FileChunks) -> None:
    for chunk in python_chunks.chunks:
        assert chunk.start_line >= 1
        assert chunk.end_line >= chunk.start_line


def test_typescript_file_extracts_exported_symbols(
    typescript_chunks: FileChunks,
) -> None:
    names = {c.symbol_name for c in typescript_chunks.chunks}
    assert "add" in names
    assert "multiply" in names
    assert "Calculator" in names


def test_file_without_functions_yields_one_module_chunk() -> None:
    result = chunk_file(FIXTURES / "constants_only.py", repo_root=FIXTURES)
    assert result is not None
    assert len(result.chunks) == 1
    assert result.chunks[0].symbol_kind == "module"
    assert result.chunks[0].chunk_index == 0


def test_unsupported_extension_returns_none(tmp_path: Path) -> None:
    file = tmp_path / "README.md"
    file.write_text("# Hello")
    assert chunk_file(file) is None


def test_oversized_file_returns_none(tmp_path: Path) -> None:
    file = tmp_path / "big.py"
    file.write_bytes(b"x" * 300_000)
    assert chunk_file(file) is None


def test_filechunks_has_relative_path(python_chunks: FileChunks) -> None:
    assert python_chunks.path == "sample.py"  # relative to FIXTURES root


def test_content_hash_is_sha256(python_chunks: FileChunks) -> None:
    # sha256 hexdigest is 64 chars
    assert len(python_chunks.content_hash) == 64
    for chunk in python_chunks.chunks:
        assert len(chunk.content_hash) == 64
