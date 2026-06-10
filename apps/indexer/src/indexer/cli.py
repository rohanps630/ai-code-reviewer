"""CLI entry point for the indexer.

Usage:
    uv run python -m indexer.cli index <repo-url>
"""

from __future__ import annotations

import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser(prog="acr-indexer", description="AI Code Reviewer — indexer")
    sub = parser.add_subparsers(dest="command")

    index_p = sub.add_parser("index", help="Index a GitHub repo")
    index_p.add_argument("repo_url", help="GitHub repo URL (https://github.com/<owner>/<name>)")

    args = parser.parse_args()

    if args.command == "index":
        from indexer.pipeline import index_repo

        try:
            stats = index_repo(args.repo_url)
            print(f"Indexing complete: {stats}")
        except Exception as exc:
            print(f"Indexing failed: {exc}", file=sys.stderr)
            return 1
        return 0

    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
