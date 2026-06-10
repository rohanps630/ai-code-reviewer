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
    """Detect the tree-sitter grammar name for a file based on its extension.

    Args:
        path: Path to the target file.

    Returns:
        The grammar name string (e.g., "python", "typescript") if supported,
        or None if the extension is unknown.
    """
    return _EXTENSION_MAP.get(path.suffix.lower())


def is_supported(path: Path) -> bool:
    """Determine whether the indexer supports chunking the given file.

    Args:
        path: Path to the target file.

    Returns:
        True if the file extension is supported, False otherwise.
    """
    return detect_language(path) is not None
