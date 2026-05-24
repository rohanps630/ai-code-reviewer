"""Eval harness CLI (Phase 4.7).

Wires the dataset loader, the TS agent bridge, the LLM judge, the
deterministic scorers, and the summary aggregator into one command.

Usage:
    uv run python -m evals.cli run --dataset v1
    uv run python -m evals.cli run --dataset v1 --limit 3 --output-dir /tmp/eval

The CLI is the first place real Anthropic tokens get spent against
this codebase — every prior phase exercised the wiring with mocked
clients. Build-time tests in `test_cli.py` keep using stubs so no
spend happens unless you actually invoke `run` against the real
dataset.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import traceback
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from evals.bridge import BridgeError, SubprocessBridge
from evals.judge import DEFAULT_JUDGE_MODEL
from evals.runner import BridgeResult, run_eval
from evals.schema import EvalExample, load_examples_jsonl
from evals.scorers.types import PredictedReview
from evals.summary import (
    ExampleResult,
    RunSummary,
    build_summary,
    dump_summary,
    find_latest_summary,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

    from evals.judge import AnthropicClient

# Default paths inside the repo. Resolved relative to this file so the
# CLI works regardless of cwd.
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
DEFAULT_DATASETS_ROOT = _REPO_ROOT / "evals" / "datasets"
DEFAULT_RESULTS_ROOT = _REPO_ROOT / "evals" / "results"

# A "no findings" review used when the bridge errors out for a single
# example. Lets the rest of the pipeline (match_findings + judge) run
# and naturally penalize the example via a low score, rather than
# aborting the whole run.
_EMPTY_REVIEW = PredictedReview(
    summary="(bridge error — agent produced no review for this example)",
    findings=[],
    confidence="low",
)

JUDGE_VERSION = "v1"  # bump when judge prompt rubric changes; tracked in docs/prompts.md


# ────────────────────────────────────────────────────────────────────
# Bridge wrapper — catches BridgeError per example
# ────────────────────────────────────────────────────────────────────


class _ResilientBridge:
    """Wraps a bridge so a single example's failure doesn't sink the run.

    The runner.py from Phase 4.5 catches `JudgeError` per example but
    treats bridge errors as fatal. We don't want a flaky TS process or
    a hung agent loop to nuke 49 other examples; this wrapper trades
    that fatality for a degraded BridgeResult that lets downstream
    scoring proceed normally.

    Failed examples surface as:
      - empty PredictedReview (no findings → match_findings reports
        all truth as unmatched → found_ground_truth_bug=False)
      - latency_ms = 0
      - cost_usd = 0.0
      - the original BridgeError message is printed to stderr so the
        CLI's stdout stays clean for piping the summary
    """

    def __init__(self, inner: SubprocessBridge) -> None:
        self._inner = inner

    def __call__(self, example: EvalExample) -> BridgeResult:
        try:
            return self._inner(example)
        except BridgeError as exc:
            print(f"[bridge-error] {example.id}: {exc}", file=sys.stderr)
            return BridgeResult(
                review=_EMPTY_REVIEW,
                latency_ms=0,
                cost_usd=0.0,
            )


# ────────────────────────────────────────────────────────────────────
# Version helpers
# ────────────────────────────────────────────────────────────────────


def _git_short_sha() -> str:
    """Return the current git short SHA, or 'unknown' if not in a repo."""
    try:
        out = subprocess.run(  # noqa: S603
            ["git", "rev-parse", "--short", "HEAD"],  # noqa: S607 — trusted system git
            capture_output=True,
            text=True,
            check=False,
            cwd=_REPO_ROOT,
        )
    except OSError:
        return "unknown"
    if out.returncode != 0:
        return "unknown"
    return out.stdout.strip() or "unknown"


def _generate_run_id(dataset_version: str) -> str:
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return f"{dataset_version}-{timestamp}"


# ────────────────────────────────────────────────────────────────────
# Anthropic client factory (lazy import — keeps test path clean)
# ────────────────────────────────────────────────────────────────────


def _default_anthropic_client() -> AnthropicClient:
    """Construct a real Anthropic SDK client. Server-only; fails loud
    if `ANTHROPIC_API_KEY` is missing."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise SystemExit(
            "ANTHROPIC_API_KEY is not set. The judge needs it to score reviews.\n"
            "Export it before running `evals.cli run`, or set --no-judge for a "
            "deterministic-scorers-only dry run (not implemented in 4.7)."
        )
    try:
        from anthropic import Anthropic  # noqa: PLC0415  — lazy to keep tests fast
    except ImportError as exc:
        raise SystemExit("anthropic SDK not installed. Run `uv sync` to install it.") from exc
    return Anthropic(api_key=api_key)


# ────────────────────────────────────────────────────────────────────
# Pretty-printer for the human-readable summary
# ────────────────────────────────────────────────────────────────────


def _print_summary(summary: RunSummary, *, prior: RunSummary | None) -> None:
    print()  # noqa: T201
    print("=" * 72)  # noqa: T201
    print(f"run_id:           {summary.run_id}")  # noqa: T201
    print(f"dataset:          {summary.dataset_version}")  # noqa: T201
    print(f"examples:         {summary.example_count}")  # noqa: T201
    print(f"verdict:          {summary.verdict}")  # noqa: T201
    print("-" * 72)  # noqa: T201
    print(f"judge_score:           {summary.judge_score:.3f}")  # noqa: T201
    print(f"deterministic_score:   {summary.deterministic_score:.3f}")  # noqa: T201
    print(f"false_positive_rate:   {summary.false_positive_rate:.3f}")  # noqa: T201
    print(f"trap_rate:             {summary.trap_rate:.3f}")  # noqa: T201
    print(f"p50_latency_ms:        {summary.p50_latency_ms}")  # noqa: T201
    print(f"p95_latency_ms:        {summary.p95_latency_ms}")  # noqa: T201
    print(f"mean_cost_per_review:  ${summary.mean_cost_per_review_usd:.4f}")  # noqa: T201
    print(f"total_cost_usd:        ${summary.total_cost_usd:.4f}")  # noqa: T201
    print(f"failed_judge_count:    {summary.failed_judge_count}")  # noqa: T201
    if prior is not None and summary.delta:
        print("-" * 72)  # noqa: T201
        print(f"delta vs prior run ({prior.run_id}):")  # noqa: T201
        for key, value in summary.delta.items():
            arrow = "↑" if value > 0 else "↓" if value < 0 else "="
            print(f"  {key:30s}  {arrow}{value:+.4f}")  # noqa: T201
    print("=" * 72)  # noqa: T201


# ────────────────────────────────────────────────────────────────────
# `run` subcommand
# ────────────────────────────────────────────────────────────────────


def run(
    args: argparse.Namespace,
    *,
    bridge_factory: type[SubprocessBridge] | None = None,
    anthropic_client_factory: type | None = None,
) -> int:
    """Execute the `run` subcommand. Returns the desired exit code."""
    dataset_path = Path(args.datasets_root) / args.dataset / "examples.jsonl"
    if not dataset_path.is_file():
        print(f"dataset not found: {dataset_path}", file=sys.stderr)  # noqa: T201
        return 2

    examples = load_examples_jsonl(dataset_path)
    if args.limit is not None:
        examples = examples[: args.limit]
    if not examples:
        print("no examples to run", file=sys.stderr)  # noqa: T201
        return 2

    bridge_cls = bridge_factory or SubprocessBridge
    inner_bridge = bridge_cls(
        default_model=args.bridge_model,
        timeout_seconds=args.bridge_timeout,
    )
    bridge = _ResilientBridge(inner_bridge)

    # The factory indirection keeps the test path off the real SDK.
    judge_client_factory = anthropic_client_factory or _default_anthropic_client
    judge_client = judge_client_factory()

    run_id = args.run_id or _generate_run_id(args.dataset)
    output_dir = Path(args.output_dir) if args.output_dir else Path(args.results_root) / run_id

    print(  # noqa: T201
        f"Running {len(examples)} example(s) against dataset {args.dataset} "
        f"(run_id={run_id}, output={output_dir})",
        file=sys.stderr,
    )

    def _on_example_start(example: EvalExample) -> None:
        print(f"  [{example.id}] starting...", file=sys.stderr)  # noqa: T201

    def _on_example_done(example: EvalExample, result: ExampleResult) -> None:
        judge_label = (
            f"judge={result.judge_score:.2f}" if result.judge_score is not None else "judge=N/A"
        )
        bug_label = "bug=found" if result.match.found_ground_truth_bug else "bug=missed"
        print(  # noqa: T201
            f"  [{example.id}] done: {bug_label} {judge_label} latency={result.latency_ms}ms",
            file=sys.stderr,
        )

    results = run_eval(
        examples=list(examples),
        bridge=bridge,
        judge_client=judge_client,
        judge_model=args.judge_model,
        output_dir=output_dir,
        on_example_start=_on_example_start,
        on_example_done=_on_example_done,
    )

    prior = None if args.no_delta else find_latest_summary(Path(args.results_root))

    summary = build_summary(
        run_id=run_id,
        agent_version=args.agent_version or _git_short_sha(),
        prompt_version=args.prompt_version,
        judge_version=JUDGE_VERSION,
        judge_model=args.judge_model,
        dataset_version=args.dataset,
        results=results,
        prior=prior,
    )

    summary_path = output_dir / "summary.json"
    dump_summary(summary, summary_path)
    print(f"\nsummary written: {summary_path}", file=sys.stderr)  # noqa: T201

    _print_summary(summary, prior=prior)

    # Verdict drives exit code: pass = 0, below-bar = 1. CI fails the
    # run on below-bar so PR comments still post but the job is marked
    # failed.
    return 0 if summary.verdict == "pass" else 1


# ────────────────────────────────────────────────────────────────────
# Argparse wiring
# ────────────────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="evals.cli",
        description="AI Code Reviewer — eval harness CLI.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    run_p = sub.add_parser("run", help="Run an eval pass over a dataset version.")
    run_p.add_argument(
        "--dataset",
        required=True,
        help="Dataset version under evals/datasets/, e.g. 'v1'.",
    )
    run_p.add_argument(
        "--datasets-root",
        default=str(DEFAULT_DATASETS_ROOT),
        help=f"Datasets root (default {DEFAULT_DATASETS_ROOT}).",
    )
    run_p.add_argument(
        "--results-root",
        default=str(DEFAULT_RESULTS_ROOT),
        help=f"Results root (default {DEFAULT_RESULTS_ROOT}).",
    )
    run_p.add_argument(
        "--output-dir",
        default=None,
        help="Per-run output dir. Default: <results_root>/<run_id>/.",
    )
    run_p.add_argument(
        "--run-id",
        default=None,
        help="Override the auto-generated run id (<dataset>-<UTC-timestamp>).",
    )
    run_p.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Run only the first N examples. Default: all.",
    )
    run_p.add_argument(
        "--bridge-model",
        default="sonnet",
        choices=["haiku", "sonnet", "opus"],
        help="Model the agent (via the bridge) uses for reviews. Default: sonnet.",
    )
    run_p.add_argument(
        "--bridge-timeout",
        type=float,
        default=300.0,
        help="Per-example bridge timeout in seconds. Default: 300.",
    )
    run_p.add_argument(
        "--judge-model",
        default=DEFAULT_JUDGE_MODEL,
        help=f"Model the LLM judge uses. Default: {DEFAULT_JUDGE_MODEL}.",
    )
    run_p.add_argument(
        "--agent-version",
        default=None,
        help="Stamp the summary with this agent version. Default: git short SHA.",
    )
    run_p.add_argument(
        "--prompt-version",
        default="unknown",
        help=(
            "Stamp the summary with this prompt version. Manual sync — "
            "see CURRENT_PROMPT_VERSION in packages/agent/src/prompts/index.ts."
        ),
    )
    run_p.add_argument(
        "--no-delta",
        action="store_true",
        help="Skip loading the prior run for delta comparison.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "run":
            return run(args)
        parser.print_help()
        return 2
    except SystemExit:
        # SystemExit from sub-helpers (e.g. _default_anthropic_client)
        # carries an explicit code/message; pass it through.
        raise
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
