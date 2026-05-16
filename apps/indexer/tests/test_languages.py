"""Language-detection sanity tests."""

from __future__ import annotations

from pathlib import Path

from indexer.languages import detect_language, is_supported


def test_python_detection() -> None:
    assert detect_language(Path("auth/login.py")) == "python"
    assert detect_language(Path("pkg/types.pyi")) == "python"


def test_typescript_family_detection() -> None:
    assert detect_language(Path("src/foo.ts")) == "typescript"
    assert detect_language(Path("src/foo.tsx")) == "tsx"
    assert detect_language(Path("src/foo.js")) == "javascript"
    assert detect_language(Path("src/foo.jsx")) == "javascript"


def test_unsupported_languages_return_none() -> None:
    assert detect_language(Path("README.md")) is None
    assert detect_language(Path("Makefile")) is None
    assert detect_language(Path("data.json")) is None


def test_is_supported_matches_detect_language() -> None:
    assert is_supported(Path("auth.py")) is True
    assert is_supported(Path("README.md")) is False
