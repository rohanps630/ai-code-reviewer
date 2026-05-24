"""Render an eval RunSummary JSON as a GitHub-flavored Markdown comment.

Run as: `python3 render-eval-comment.py <path-to-summary.json>`. Writes
to stdout so the workflow can pipe it into `gh pr comment` or read it
into an `actions/github-script` payload.

Lives in `.github/scripts/` because it's CI-only and shouldn't pull in
the rest of the eval package — keeps the workflow's setup minimal
(stdlib `json` is the only import).

Tested by `apps/indexer/tests/test_render_eval_comment.py` against a
representative summary fixture.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def _fmt_metric(value: float | None, *, fmt: str = "{:.3f}") -> str:
    if value is None:
        return "n/a"
    return fmt.format(value)


def render(summary: dict) -> str:
    verdict = summary["verdict"]
    verdict_emoji = "✅" if verdict == "pass" else "❌"

    lines: list[str] = [
        f"## {verdict_emoji} Eval run: `{summary['run_id']}`",
        "",
        f"**Verdict**: `{verdict}` · "
        f"**Dataset**: `{summary['dataset_version']}` "
        f"({summary['example_count']} examples) · "
        f"**Agent**: `{summary['agent_version']}` · "
        f"**Prompt**: `{summary['prompt_version']}` · "
        f"**Judge**: `{summary['judge_model']}` ({summary['judge_version']})",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| Judge score | `{_fmt_metric(summary['judge_score'])}` |",
        f"| Deterministic score | `{_fmt_metric(summary['deterministic_score'])}` |",
        f"| False positive rate | `{_fmt_metric(summary['false_positive_rate'])}` |",
        f"| Trap rate | `{_fmt_metric(summary['trap_rate'])}` |",
        f"| P50 latency | `{summary['p50_latency_ms']}ms` |",
        f"| P95 latency | `{summary['p95_latency_ms']}ms` |",
        f"| Mean cost / review | `${_fmt_metric(summary['mean_cost_per_review_usd'], fmt='{:.4f}')}` |",
        f"| Total cost | `${_fmt_metric(summary['total_cost_usd'], fmt='{:.4f}')}` |",
        f"| Failed judge count | `{summary['failed_judge_count']}` |",
        "",
    ]

    by_difficulty = summary.get("by_difficulty") or {}
    if by_difficulty:
        lines += [
            "### By difficulty",
            "",
            "| Difficulty | Count | Judge | Deterministic | False pos | Trap |",
            "|---|---|---|---|---|---|",
        ]
        # Preserve a stable ordering rather than dict key order
        for diff in ("easy", "medium", "hard"):
            if diff not in by_difficulty:
                continue
            bd = by_difficulty[diff]
            lines.append(
                f"| {diff} | {bd['count']} | "
                f"{_fmt_metric(bd['judge_score'])} | "
                f"{_fmt_metric(bd['deterministic_score'])} | "
                f"{_fmt_metric(bd['false_positive_rate'])} | "
                f"{_fmt_metric(bd['trap_rate'])} |"
            )
        lines.append("")

    delta = summary.get("delta")
    if delta:
        lines += ["### Δ vs prior run", ""]
        for key, value in delta.items():
            arrow = "📈" if value > 0 else "📉" if value < 0 else "➡️"
            lines.append(f"- {arrow} **{key}**: `{value:+.4f}`")
        lines.append("")

    lines.append(
        "_Posted by `.github/workflows/eval.yml` · "
        "`raw/<example-id>.json` traces available as the workflow's "
        "uploaded artifact._"
    )
    return "\n".join(lines)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: render-eval-comment.py <summary.json>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"summary not found: {path}", file=sys.stderr)
        return 2
    summary = json.loads(path.read_text())
    print(render(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
