"""Language detection from file extensions.

Keep this conservative — adding a language means picking the right
tree-sitter grammar name AND extending the chunker's node-kind map in
`chunking.py`. Today we support Python and the TypeScript/JavaScript
family. Add more as eval coverage demands.
"""

from __future__ import annotations

from pathlib import Path
from typing import Final

# Extension → tree-sitter-language-pack grammar name.
# The grammar name is what we pass to `get_language(...)`.
_EXTENSION_MAP: Final[dict[str, str]] = {
    ".py": "python",
    ".pyi": "python",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "javascript",  # JSX in .js files parses with the JS grammar
    ".mjs": "javascript",
    ".cjs": "javascript",
}


def detect_language(path: Path) -> str | None:
    """Return the tree-sitter grammar name for a path, or None if unsupported."""
    return _EXTENSION_MAP.get(path.suffix.lower())


def is_supported(path: Path) -> bool:
    """Whether the indexer knows how to chunk this file."""
    return detect_language(path) is not None
