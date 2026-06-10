"""Tests for the indexer pipeline orchestration.

Uses mocks for DB, embedder, and contextualizer to validate the
pipeline's control flow without requiring real services.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from indexer.pipeline import _walk_supported_files


class TestWalkSupportedFiles:
    """Unit tests for the file walker."""

    def test_finds_supported_files(self, tmp_path: Path) -> None:
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "app.ts").write_text("const x = 1;")
        (tmp_path / "src" / "utils.py").write_text("x = 1")
        (tmp_path / "README.md").write_text("# hello")

        files = _walk_supported_files(tmp_path)
        names = {f.name for f in files}
        assert "app.ts" in names
        assert "utils.py" in names
        assert "README.md" not in names  # unsupported

    def test_skips_hidden_dirs(self, tmp_path: Path) -> None:
        (tmp_path / ".git").mkdir()
        (tmp_path / ".git" / "config.py").write_text("x = 1")
        (tmp_path / "src.py").write_text("x = 1")

        files = _walk_supported_files(tmp_path)
        assert len(files) == 1
        assert files[0].name == "src.py"

    def test_skips_node_modules(self, tmp_path: Path) -> None:
        (tmp_path / "node_modules").mkdir()
        (tmp_path / "node_modules" / "pkg.js").write_text("x = 1;")
        (tmp_path / "app.js").write_text("x = 1;")

        files = _walk_supported_files(tmp_path)
        assert len(files) == 1
        assert files[0].name == "app.js"


class TestPipelineOrchestration:
    """Integration test with mocked external deps."""

    @patch("indexer.pipeline.subprocess")
    def test_index_repo_orchestration(self, mock_subprocess: MagicMock, tmp_path: Path) -> None:
        """Verify the pipeline calls clone → walk → chunk → embed → write."""
        # Mock DB
        mock_db = MagicMock()
        mock_db.get_repo_by_url.return_value = {
            "id": "test-repo-id",
            "url": "https://github.com/test/repo",
        }
        mock_db.get_document_content_hash.return_value = None  # all files are "new"
        mock_db.upsert_document.return_value = "test-doc-id"
        mock_db.replace_chunks.return_value = 1

        # Mock git clone to create a file in the temp dir
        def fake_clone(args, **kwargs):
            if args[0] == "git" and args[1] == "clone":
                dest = args[-1]
                src = Path(dest) / "src"
                src.mkdir(parents=True, exist_ok=True)
                (src / "hello.py").write_text("def hello():\n    return 'world'\n")
                return MagicMock(returncode=0)
            if args[0] == "git" and args[1] == "rev-parse":
                result = MagicMock()
                result.stdout = "abc123\n"
                return result
            return MagicMock()

        mock_subprocess.run.side_effect = fake_clone

        # Mock settings
        mock_settings = MagicMock()
        mock_settings.anthropic_api_key = ""  # skip contextualization
        mock_settings.voyage_api_key = ""  # skip embedding
        mock_settings.database_url = ""

        from indexer.pipeline import index_repo

        stats = index_repo(
            "https://github.com/test/repo",
            settings=mock_settings,
            db=mock_db,
        )

        # Verify DB was called
        mock_db.get_repo_by_url.assert_called_once_with("https://github.com/test/repo")
        mock_db.update_repo_status.assert_any_call("test-repo-id", status="indexing")
        assert mock_db.upsert_document.called
        assert mock_db.replace_chunks.called
        mock_db.update_repo_status.assert_any_call(
            "test-repo-id", status="indexed", last_indexed_commit="abc123"
        )
        assert stats["files_chunked"] >= 1
