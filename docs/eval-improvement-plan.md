# Eval improvement plan

> Current baseline: v1 Ollama (qwen3.5) — judge 0.635, deterministic 0.20, FP rate 0.667.
> Target: judge ≥ 0.80, deterministic ≥ 0.50, FP rate ≤ 0.20.
>
> This document is a ranked execution plan, not a roadmap. Execute top-down.

---

## Why the current baseline is misleading

The v1 baseline has two confounds that make it harder to interpret than it looks:

**1. Ollama judge failures (10 / 30 examples)**: `qwen3.5:latest` timed out or produced malformed judge output on 10 examples. These are dropped from the aggregate — the 0.635 is computed over 20 examples, not 30. A Claude judge won't have this problem.

**2. Deterministic matching is too strict**: In `seed-ts-no-await`, the agent's judge score was 1.0 (correctly identified the missing await), but `match.found_ground_truth_bug` was `false` and `false_positives` was 1. The Jaccard overlap between the agent's location hint (`src/services/user.ts:9-10`) and the ground truth string failed. The false positive count is inflated by the same strictness — the agent's finding is semantically correct but doesn't match the ground truth string pattern.

**This means**: the 67% FP rate and 0.20 deterministic score may not reflect the agent's actual behavior. Fix the judge before concluding the agent is broken.

---

## Ranked improvements

### 1. Run evals with a Claude judge — 1 day, highest leverage

**What**: Replace `qwen3.5:latest` as the judge with `claude-haiku-4-5-20251001` (cheap, reliable).

**Why**: The 10/30 judge failures make the current baseline uninterpretable. A reliable judge is the prerequisite for every other improvement.

**How**:
```bash
cd apps/indexer
uv run python -m evals.cli run \
  --dataset v1 \
  --judge-model claude-haiku-4-5 \
  --agent-version $(git rev-parse --short HEAD) \
  --run-id v1-claude-judge
```

**Expected outcome**: The new judge score will differ from 0.635. If it's higher, the Ollama judge was systematically wrong. If it's lower, the agent is actually worse than the baseline suggested. Either way, we now have a trustworthy number.

**Commit**: The run summary to `evals/results/v1-claude-judge/summary.json`.

---

### 2. Fix the deterministic matcher — 1 day, high leverage

**What**: The Jaccard token overlap between `agent_finding.location_hint` and `ground_truth.location_hint` is failing on semantically correct findings. The matcher needs one of:
- Normalized path comparison (strip `src/`, normalize separators)
- Line range overlap check (agent says `:9-10`, truth says `:9`; both are correct)
- A fallback: if judge score ≥ 0.8, count the finding as matched even if deterministic fails

**Why**: The deterministic score of 0.20 is the most visually alarming metric in the baseline. If a significant portion of that is matching failures rather than agent failures, fixing the matcher will produce a more accurate picture and make regression detection meaningful.

**How**: Audit the raw results in `evals/results/ollama-baseline/raw/` for cases where `judge.score >= 0.7` but `match.found_ground_truth_bug == false`. These are the false negatives in the deterministic matcher. Fix the scorer in `apps/indexer/src/evals/scorers.py`.

---

### 3. Add false positive traps to existing examples — 2 days, high leverage

**What**: The current dataset has `false_positive_traps: []` on all 30 examples (`trap_rate: 0.0`). This means the agent has never been penalized for flagging legitimate code. The 67% FP rate is computed as "findings outside the ground truth," but without traps the agent doesn't know which patterns are intentionally left unflagged.

**Why**: The FP rate is the metric that matters most for user trust. A reviewer who generates 67% noise is unusable. Adding traps tells us whether the FP rate is structural (the agent genuinely over-flags) or a measurement artifact (findings that are correct but aren't in the ground truth).

**How**: For each of the 15 easy examples, add 1–2 false positive traps — code patterns in the diff that look suspicious but are intentional. Examples:
- A mutable default argument that's intentionally shared state
- A bare `except` that's intentional for a cleanup path
- A missing await on a fire-and-forget write

Update the ground truth in `examples.jsonl`:
```jsonl
{
  "ground_truth": {
    "findings": [...],
    "false_positive_traps": [
      "The bare except on line 12 is intentional — it catches KeyboardInterrupt for cleanup"
    ]
  }
}
```

---

### 4. Run a Claude agent baseline — 2–3 days, prerequisite for v2

**What**: Run the v1 dataset through the production agent (Claude Sonnet, with Voyage retrieval if available; without if not) and commit the summary.

**Why**: The entire portfolio claim rests on "the agent uses Claude Sonnet." The only committed baseline uses Ollama. The production-model performance is currently unknown.

**Expected cost**: $0.635 judge score × 30 examples × ~$0.10–$0.30 per review (Sonnet, no caching on first run) ≈ $3–$9 for a full Claude-agent + Claude-judge run. Within the $0.50/review cap.

**Commit**: As `evals/results/v1-claude-agent-<date>/summary.json` with `agent_version`, `prompt_version`, and `judge_model` fields populated.

---

### 5. Prompt improvement: FP reduction pass — 3 days, depends on #1 and #4

**What**: Once we have a reliable judge and a Claude agent baseline, the 67% FP rate is addressable through the prompt. The most common FP pattern in the Ollama run (from inspecting raw results): the agent flags style/naming issues as bugs. The system prompt needs a stronger instruction: "Only flag issues that would cause incorrect behavior, data loss, security vulnerabilities, or measurable performance degradation. Style issues are not findings."

**How**: Make the prompt change in `packages/agent/src/prompts/`. Run the eval. Check if judge score held and FP rate dropped. If judge score drops > 0.05, revert. Document the delta in `docs/prompts.md`.

**Target**: FP rate < 0.40 on the existing dataset. (0.20 requires better dataset coverage, not just a prompt change.)

---

### 6. Add 5 real public-PR examples — 1 week, enables generalization claims

**What**: Find 5 merged PRs from popular open-source repositories where a reviewer caught a real bug in the PR comments. Add them as eval examples with `pr_url` populated and `source_comment_url` pointing to the original reviewer comment.

**Why**: The synthetic dataset proves the harness works. It doesn't prove the agent generalizes to real codebases. Five real examples is the minimum to make a generalization claim.

**Source candidates**: React, TypeScript, Python CPython, or Anthropic-SDK PRs where the original review caught a security or bug issue. Filter for: merged PRs, concrete bug findings, publicly visible review comments.

**How**: Use the `/new-eval <pr-url>` Claude Code slash command to add examples. Each addition should be its own PR so the eval workflow runs automatically and the delta is visible.

---

## Ablation design

> Goal: prove that AST + BM25 + vector + rerank outperforms simpler alternatives on the same dataset.
> Minimum viable: 4 configurations × 30 examples. Runtime: ~3 hours if run with a fast judge.

### Dataset requirements

Use the existing v1 dataset (30 examples). No new data collection needed. The ablation runs the eval harness 4 times with different retrieval configurations and compares results.

### Retrieval configurations

| ID | Chunking | Search | Rerank | Description |
|---|---|---|---|---|
| `A-baseline` | Line-split (512 tokens) | Vector only | None | Naive RAG — what most tutorials implement |
| `B-bm25-only` | Line-split (512 tokens) | BM25 only | None | Keyword search, no semantic |
| `C-hybrid-no-ast` | Line-split (512 tokens) | BM25 + vector + RRF | Cohere rerank | Hybrid without AST chunking |
| `D-full` | AST (current) | BM25 + vector + RRF | Cohere rerank | Current production configuration |

### Metrics to report

Per configuration, report:
- Judge score (mean, with 95% CI bootstrapped over 30 examples)
- False positive rate (mean)
- Retrieval recall@10 (fraction of examples where a chunk containing the ground truth location was in the top-10 retrieved)
- Mean latency (P50, P95)
- Mean cost per review

### The key question

If retrieval recall@10 is significantly higher for `D-full` than `A-baseline`, and judge score tracks retrieval recall, the ablation proves AST + hybrid + rerank is doing real work. If judge score and FP rate are similar across configurations, the bottleneck is somewhere else (prompt quality, agent reasoning) — which is also a useful result.

### Reporting format

Commit results as `evals/results/ablation-<date>/`:
```
ablation-2026-06-XX/
  A-baseline/summary.json
  B-bm25-only/summary.json
  C-hybrid-no-ast/summary.json
  D-full/summary.json
  comparison.md   ← table comparing all four, conclusion sentence
```

`comparison.md` format:

```markdown
# Retrieval ablation — v1 dataset

| Config | Judge score | FP rate | Recall@10 | P50 latency |
|---|---|---|---|---|
| A — naive RAG | X.XX | X.XX | X.XX | Xs |
| B — BM25 only | X.XX | X.XX | X.XX | Xs |
| C — hybrid, no AST | X.XX | X.XX | X.XX | Xs |
| D — full (current) | X.XX | X.XX | X.XX | Xs |

**Conclusion**: [one sentence — e.g., "AST chunking + reranking improved recall@10 by X% and reduced FP rate by Y% vs. naive RAG."]
```

### Execution order

1. Implement a `--retrieval-config` flag in `evals.cli run` that swaps the chunking + search strategy
2. Run all four configs in sequence against v1 with a Claude judge
3. Commit results and `comparison.md`
4. If `D-full` wins, link to `comparison.md` from the README eval section

---

## Priority order summary

| # | Action | Effort | Unblocks |
|---|---|---|---|
| 1 | Run Claude judge on v1 | 1 day | Trustworthy baseline |
| 2 | Fix deterministic matcher | 1 day | Accurate FP measurement |
| 3 | Add FP traps to examples | 2 days | Meaningful FP rate |
| 4 | Run Claude agent baseline | 2–3 days | Production-model evidence |
| 5 | Prompt FP reduction pass | 3 days | Improved FP rate |
| 6 | Add 5 real PR examples | 1 week | Generalization claim |
| 7 | Run retrieval ablation | 3 days | Comparative evidence |

Items 1–4 are the evidence gap. Items 5–7 are quality improvements. Do 1–4 before claiming any eval quality number.
