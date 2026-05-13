# Evals

> Methodology for measuring whether the agent is getting better or worse. Evals are the project's single most important loop — every other improvement is measured here.

## Philosophy

- **Evals matter more than tests** for AI behavior. Tests assert structure; evals assert quality.
- **Start small.** 30 examples beats no examples. 50 is plenty for a portfolio project.
- **Iterate the dataset.** Add an example every time the agent makes a surprising mistake in real use.
- **One metric is a lie.** Track judge score, deterministic score, false positives, latency, and cost together.

## Dataset structure

Datasets are versioned. Once published, examples in a version are immutable — new examples go in a new version.

```
evals/
└── datasets/
    └── v1/
        ├── README.md       # Dataset metadata and example count
        └── examples.jsonl  # One JSON object per line
```

## Example schema

```json
{
  "id": "react-pr-12345-effect-cleanup",
  "pr_url": "https://github.com/facebook/react/pull/12345",
  "pr_title": "Fix useEffect cleanup ordering",
  "pr_diff": "...",
  "ground_truth": {
    "findings": [
      {
        "category": "bug",
        "severity": "major",
        "summary": "Cleanup function references stale state captured by closure",
        "location_hint": "src/hooks.ts:42",
        "source_comment_url": "https://github.com/facebook/react/pull/12345#discussion_r..."
      }
    ],
    "expected_findings_count": 1,
    "false_positive_traps": [
      "The renamed variable on line 30 is intentional and not a bug"
    ]
  },
  "difficulty": "medium",
  "added_at": "2026-05-01",
  "added_by": "your-handle"
}
```

## Difficulty levels

- **easy** — single-file change, clear bug, no domain knowledge needed
- **medium** — multi-file change, requires understanding of how pieces interact
- **hard** — subtle bug, requires deep domain knowledge or non-obvious reasoning

Aim for roughly 50/35/15 mix.

## Scoring

Each eval run produces two scores per example, then aggregates.

### LLM-as-judge

A separate Claude call evaluates the agent's output against the ground truth.

Rubric (0–1):

- 0.0 — missed the bug entirely
- 0.3 — flagged something nearby but wrong
- 0.5 — partial — identified the area but not the issue
- 0.7 — correct issue but unclear/poorly explained
- 1.0 — correct, well-explained, actionable

The judge prompt is in `apps/indexer/src/evals/judges/main_judge.py` and is itself versioned.

### Deterministic

A Python scorer parses the agent's output and checks:

- `found_ground_truth_bug`: bool — did any finding's `summary` semantically match the ground truth?
- `false_positives`: int — findings that don't match ground truth AND aren't in `false_positive_traps`
- `false_positive_traps_triggered`: int — explicit traps the agent fell for

Semantic matching uses a small embedding similarity check, not regex.

### Aggregate metrics

Per run, computed across all examples:

- `judge_score` — mean LLM judge score
- `deterministic_score` — fraction where `found_ground_truth_bug` is true
- `false_positive_rate` — mean false positives per example
- `trap_rate` — fraction of examples where any trap was triggered
- `p50_latency_ms`, `p95_latency_ms`
- `mean_cost_per_review_usd`, `total_cost_usd`

## Running

```bash
cd apps/indexer
uv run python -m evals.cli run \
  --dataset v1 \
  --agent-version "$(git rev-parse --short HEAD)" \
  --prompt-version "v0.3"
```

Output: `evals/results/<run-id>/summary.json` plus per-example traces in `evals/results/<run-id>/raw/`.

## Comparing runs

```bash
uv run python -m evals.cli compare <run-id-1> <run-id-2>
```

Produces a markdown table of deltas. The CI workflow does this automatically on PR.

## What a good run looks like

For Phase 4 ship:

- `judge_score`: ≥ 0.55 (this is a low bar, intentional — early Phase)
- `deterministic_score`: ≥ 0.40
- `false_positive_rate`: ≤ 1.5
- `mean_cost_per_review_usd`: ≤ $0.05

Numbers improve substantially as Phases 2–3 retrieval and agent improvements land. By end of Phase 5 expect judge ≥ 0.75, deterministic ≥ 0.65, cost ≤ $0.02.

## Adding to the dataset

Use the `/new-eval <pr-url>` Claude Code command, or do it manually:

1. Find a PR with substantive review discussion
2. Skip if reviewer was wrong, if discussion is too long, if diff > 500 lines
3. Extract the ground truth (the bug the reviewer caught)
4. Note any obvious false-positive traps (e.g. intentional renames)
5. Append a JSON line to `examples.jsonl`
6. Commit on an `eval/<slug>` branch — triggers eval workflow
