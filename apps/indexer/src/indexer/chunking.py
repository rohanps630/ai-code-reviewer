"""AST-aware chunking with tree-sitter.

Strategy (Phase 2 v1, intentionally simple — refine in eval feedback):

  1. Try to parse the file with the language's tree-sitter grammar.
  2. Walk the top-level (and one level into classes for methods) nodes.
     Emit a chunk for every function / class / method definition.
  3. If the file yielded no chunk-worthy nodes (no functions/classes
     at all), emit a single `module` chunk covering the whole file —
     so config files, scripts, and constants files still get indexed.
  4. Each chunk gets a content hash, line range, and symbol metadata.
     The contextual-prefix step (Phase 2.4) will populate
     `content_with_context` later; for now it equals `content`.

What we deliberately do NOT do here:
  - Embedding (Phase 2.3)
  - Contextual prefix generation (Phase 2.4)
  - Persistence (later)

Tree-sitter's Python binding API lives in `tree_sitter`. The compiled
grammars live in `tree_sitter_language_pack`, which exposes
`get_language(name)` returning a `Language` we can hand to `Parser`.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Final

from tree_sitter import Language, Node, Parser
from tree_sitter_language_pack import get_language

from indexer.languages import detect_language
from indexer.models import Chunk, FileChunks, SymbolKind

# Node types per grammar that we treat as chunk-worthy.
# Names follow each grammar's node-types.json.
_CHUNKABLE_NODES: Final[dict[str, dict[str, SymbolKind]]] = {
    "python": {
        "function_definition": "function",
        "class_definition": "class",
    },
    "typescript": {
        "function_declaration": "function",
        "class_declaration": "class",
        "method_definition": "method",
        "method_signature": "method",
    },
    "tsx": {
        "function_declaration": "function",
        "class_declaration": "class",
        "method_definition": "method",
        "method_signature": "method",
    },
    "javascript": {
        "function_declaration": "function",
        "class_declaration": "class",
        "method_definition": "method",
    },
}

# Cap individual file size — anything bigger is almost always vendored
# code, minified bundles, or generated output. Skipped without error.
_MAX_FILE_BYTES: Final[int] = 250_000


# Tree-sitter Parser is cheap to instantiate per call; Language objects
# are precompiled in the language pack so caching them is enough.
_LANGUAGE_CACHE: dict[str, Language] = {}


def _language_for(name: str) -> Language:
    cached = _LANGUAGE_CACHE.get(name)
    if cached is not None:
        return cached
    lang = get_language(name)  # type: ignore[arg-type]
    _LANGUAGE_CACHE[name] = lang
    return lang


def chunk_file(path: Path, *, repo_root: Path | None = None) -> FileChunks | None:
    """Chunk a single source file.

    Returns None if the file isn't supported, too big, or fails to read.
    The caller (pipeline) is responsible for repo-walk + filtering;
    this function only sees one file.
    """
    language_name = detect_language(path)
    if language_name is None:
        return None

    try:
        raw = path.read_bytes()
    except OSError:
        return None

    if len(raw) > _MAX_FILE_BYTES:
        return None
    if len(raw) == 0:
        return None

    rel_path = path.relative_to(repo_root).as_posix() if repo_root is not None else path.as_posix()
    content_hash = hashlib.sha256(raw).hexdigest()

    parser = Parser(_language_for(language_name))
    tree = parser.parse(raw)
    chunks = _extract_chunks(tree.root_node, raw, language_name)

    return FileChunks(
        path=rel_path,
        language=language_name,
        content_hash=content_hash,
        size_bytes=len(raw),
        chunks=tuple(chunks),
    )


def _extract_chunks(root: Node, source: bytes, language: str) -> list[Chunk]:
    """Walk a parsed tree and emit chunks per the strategy in this module's
    docstring. Top-level + one level deep into classes (for methods)."""
    chunkable = _CHUNKABLE_NODES.get(language, {})
    chunks: list[Chunk] = []
    index = 0

    def emit(node: Node, kind: SymbolKind) -> None:
        nonlocal index
        text = source[node.start_byte : node.end_byte].decode("utf-8", errors="replace")
        if not text.strip():
            return
        chunks.append(
            Chunk(
                chunk_index=index,
                start_line=node.start_point[0] + 1,
                end_line=node.end_point[0] + 1,
                content=text,
                content_with_context=text,
                symbol_name=_symbol_name(node, source),
                symbol_kind=kind,
                content_hash=hashlib.sha256(text.encode("utf-8")).hexdigest(),
            )
        )
        index += 1

    def walk(node: Node, depth: int) -> None:
        if depth > 2:  # don't descend forever; methods inside classes are enough
            return
        for child in node.children:
            kind = chunkable.get(child.type)
            if kind is not None:
                emit(child, kind)
                # Descend into classes to also emit their methods as
                # separate chunks (so "show me the login() method"
                # returns the method, not the whole class).
                if kind == "class":
                    walk(child, depth + 1)
            else:
                walk(child, depth + 1)

    walk(root, 0)

    if not chunks:
        # No functions/classes found — emit the whole file as one chunk
        # so config files, constants files, and small scripts still
        # land in the index.
        text = source.decode("utf-8", errors="replace")
        if text.strip():
            chunks.append(
                Chunk(
                    chunk_index=0,
                    start_line=1,
                    end_line=max(1, text.count("\n") + 1),
                    content=text,
                    content_with_context=text,
                    symbol_name=None,
                    symbol_kind="module",
                    content_hash=hashlib.sha256(text.encode("utf-8")).hexdigest(),
                )
            )

    return chunks


def _symbol_name(node: Node, source: bytes) -> str | None:
    """Find an identifier child of a definition node — that's the symbol name."""
    # Tree-sitter exposes named children with a `field_name`. The
    # "name" field exists on function_declaration, class_declaration,
    # method_definition, function_definition, class_definition.
    name_node = node.child_by_field_name("name")
    if name_node is None:
        return None
    return source[name_node.start_byte : name_node.end_byte].decode("utf-8", errors="replace")
