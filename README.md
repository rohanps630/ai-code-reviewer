# AI Code Reviewer

An AI agent that reviews GitHub pull requests by retrieving relevant repository context, not just reading the diff.

> **Status**: Phases 1–5 complete (foundations, retrieval, agent runtime, evals, production concerns).
> Phase 7 (GitHub-native CI delivery) — `packages/github` and `acr-review` CLI are implemented; self-review workflow pending.

---

## The problem

Diff-only review tools miss the issues that matter: the caller this change just broke, the interface the new type is supposed to satisfy, the test that now exercises dead code. Mega-prompt tools paste the entire repository into context, which is slow, expensive, and produces the same misses for different reasons.

The interesting problem is in between: retrieve the right 3–5% of a repository that is load-bearing for a given diff, structure it so the model can reason rather than scan, and measure with a harness whether the retrieval actually improved review quality.

---

## What is implemented

| Component | Status | Notes |
|---|---|---|
| Agent runtime (`packages/agent`) | ✅ Complete | Hand-written model-agnostic ReAct loop, no framework |
| Hybrid retrieval pipeline | ✅ Complete | AST chunking → BM25 + vector → RRF → Cohere rerank |
| Provider support | ✅ Complete | Anthropic, OpenAI, Google, Groq, Ollama behind one seam |
| Eval harness | ✅ Complete | 30-example golden dataset, LLM-as-judge + deterministic scoring |
| Committed baseline | ✅ Complete | v1 below-bar verdict published (see Eval Baseline below) |
| Production concerns | ✅ Complete | Prompt caching, semantic caching, model routing, Langfuse tracing |
| Prompt injection defense | ✅ Complete | XML fence escaping, E2B sandbox for code execution |
| GitHub delivery package (`packages/github`) | ✅ Complete | `fetchPr`, `mapFinding`, `submitReview` via Octokit |
| `acr-review` CLI (`apps/cli`) | ✅ Complete | `acr-review --pr <url> [--dry-run]` |
| Self-review GitHub Actions workflow | 🔲 Pending | Milestone 1 of Phase 7 — see ADR-006 |
| Public hosted demo | 🔲 Pending | Vercel deploy exists; public demo URL not yet configured |

---

## Architecture

```
apps/web         → Next.js 16 app (review UI, /api/reviews)
apps/indexer     → Python 3.12: AST chunking, embeddings, eval harness
apps/cli         → acr-review CLI binary (GitHub-native delivery)
apps/worker      → Background worker (long-running indexing jobs)

packages/agent   → Agent runtime, runReview, tools, retrieval, providers
packages/db      → Drizzle ORM schemas (Postgres + pgvector)
packages/github  → PR fetcher, diff→line mapper, review submitter
packages/shared  → Cross-package types, env validation
```

A diff submitted to `/api/reviews` (web UI) or `acr-review --pr <url>` (CLI) flows into `runReview`, which creates one `Agent` instance and yields a `ReviewChunk` stream. The agent runs a ReAct loop, calling tools until it calls `submit_review` (the stop tool) or hits the iteration/cost cap. Results persist to Postgres; every run traces to Langfuse.

---

## Retrieval pipeline

Retrieval is the core engineering problem. The pipeline in `packages/agent/src/retrieval/`:

1. **AST chunking** (`apps/indexer`): tree-sitter parses Python and TypeScript/JavaScript at function and class boundaries. A 500-line file with ten methods becomes ten chunks, each with a contextual prefix (file path, language, enclosing scope) for embedding quality on short snippets.

2. **Indexing**: Each chunk is embedded with Voyage `voyage-code-3` (code-optimized, not general-purpose) and stored in Postgres with pgvector HNSW. Full text also goes into a BM25 index in the same table.

3. **Search**: Queries run in parallel — BM25 for lexical recall (exact symbol names), vector search for semantic recall (intent-level queries like "authentication middleware"). Top 40 from each lane.

4. **Rerank**: The 40 candidates merge via Reciprocal Rank Fusion, then Cohere `rerank-v3.5` scores each chunk against the query with a cross-encoder. Top 10 returned.

Each step is a separate function with its own input/output. When retrieval is wrong, you can inspect the BM25 results, the vector results, and the reranker scores independently.

---

## Agent runtime

`packages/agent/src/agent.ts` — the `Agent` class. `runReview` in `loop.ts` is a thin specialization of it.

The loop has four termination conditions:

```typescript
// From loop.ts
const MAX_ITERATIONS = 10;
const COST_CAP_USD = 0.50;

// Agent terminates when:
// 1. Model calls submit_review (the stop tool)
// 2. MAX_ITERATIONS reached  → AgentMaxIterationsError
// 3. Cost exceeds cap        → AgentCostCapError
// 4. Model ends turn with no tool call → AgentNoStopToolError
```

Tools available to the agent: `search_code`, `read_file`, `find_references`, `run_tests` (when E2B is configured). Each is a pure function with a Zod input schema and injected dependencies — testable without a live LLM.

**Model routing** (`routeModel` in `loop.ts`):
- Trivial: < 50 lines, single file, no exported API surface changes → Haiku
- Complex: > 500 lines or > 5 files changed → Opus
- Standard: everything else → Sonnet

**Provider cascade**: Anthropic → Groq → OpenAI → Google → Ollama (local fallback). All five providers implement the same `ModelProvider` interface; the loop sees no provider-specific code.

**Cost accounting**: A per-model pricing table (`models.ts`) tracks token spend mid-loop. The $0.50 cap is enforced inside the loop — not after the run completes.

**Prompt injection defense**: All untrusted content (diff, file contents, PR description) is wrapped in XML tags and sanitized against delimiter forgery before being passed to the model. Code execution runs in an E2B sandbox.

---

## Eval baseline

Dataset v1: 30 synthetic seeded examples covering bug, security, performance, and logic categories (15 easy, 11 medium, 4 hard). All examples use minimal realistic diffs with `pr_url: null`. Real public-PR curation is the next dataset milestone.

**Committed baseline: `evals/results/ollama-baseline/summary.json`**

| Metric | v1 Baseline | v2 Target |
|---|---|---|
| Judge score | 0.635 | ≥ 0.80 |
| Deterministic score | 0.20 | ≥ 0.50 |
| False positive rate | 0.667 | ≤ 0.20 |
| Judge failures | 10 / 30 | — |
| Agent | Ollama (qwen3.5, local) | Claude Sonnet |
| Judge | Ollama (qwen3.5, local) | Claude Sonnet |
| Cost per review | $0.00 (local) | < $0.50 |

**Verdict: below-bar.** This is the published starting line.

**Baseline notes**: The v1 baseline used Ollama (`qwen3.5:latest`) as both agent and judge — free local inference, no API cost. The 10/30 judge failures are Ollama reliability issues, not agent failures. The deterministic score of 0.20 is also misleadingly low: in cases like `seed-ts-no-await`, the judge scored the agent 1.0 (correctly identified the bug) but the Jaccard token overlap between the agent's location hint and the ground truth string failed the deterministic check. The v2 eval pass will use a Claude judge and a tuned deterministic matcher to separate these failure modes.

The CI eval workflow (`.github/workflows/eval.yml`) runs the harness on PRs that touch `packages/agent/`, `apps/indexer/src/evals/`, or `evals/datasets/`, and posts the summary as a PR comment.

---

## Known limitations

- **No self-review yet**: The ACR bot has not reviewed its own PRs. The `acr-review` CLI and `packages/github` are implemented; the GitHub Actions workflow that wires them together is the immediate next step.
- **No public URL**: The Vercel deployment exists but is not configured with a public-facing demo. Local setup required (see Getting started).
- **Synthetic-only eval dataset**: All 30 examples are synthetic with `pr_url: null`. The harness and scoring work; real-PR generalization is unmeasured.
- **No Claude baseline yet**: The committed baseline used Ollama. A Claude-based baseline run has not been committed. The production-model performance against this dataset is currently unknown.
- **Retrieval requires pre-indexed repo**: `search_code` returns empty results if the target repository has not been indexed. The CI path assumes a pre-indexed repo; on-demand indexing is not implemented.
- **Retrieval disabled without VOYAGE_API_KEY**: Falls back to diff-only reasoning — the exact failure mode this system is designed to avoid.

---

## Getting started

### Prerequisites

- Node.js 22+ (`nvm use`)
- pnpm 9+
- Python 3.12+
- [uv](https://docs.astral.sh/uv/)
- Supabase project with pgvector enabled
- API keys: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `COHERE_API_KEY` (see `.env.example`)

### Setup

```bash
pnpm install
cd apps/indexer && uv sync && cd ../..
cp .env.example apps/web/.env.local
cp .env.example apps/indexer/.env
pnpm db:migrate
pnpm dev
```

### Run an eval

```bash
cd apps/indexer
uv run python -m evals.cli run --dataset v1
# Results → evals/results/<run-id>/summary.json
```

### Review a PR from the CLI

```bash
# Build
pnpm build:packages && pnpm --filter @acr/cli build

# Dry run (prints payload, does not post)
GITHUB_TOKEN=ghp_... ANTHROPIC_API_KEY=sk-ant-... \
  node apps/cli/dist/cli.js --pr https://github.com/owner/repo/pull/123 --dry-run

# Post the review
GITHUB_TOKEN=ghp_... ANTHROPIC_API_KEY=sk-ant-... \
  node apps/cli/dist/cli.js --pr https://github.com/owner/repo/pull/123
```

### Daily workflow

```bash
pnpm cli   # Interactive menu: dev, build, test, lint, db, indexer, git
```

---

## Tests

426 total: 264 TypeScript, 162 Python.

| Package | Tests |
|---|---|
| `packages/agent` | 167 |
| `apps/web` | 45 |
| `packages/db` | 27 |
| `apps/indexer` (Python) | 162 |
| `packages/github` | 12 |
| `packages/shared` | 8 |
| `apps/cli` | 5 |

```bash
pnpm test                              # all TS packages
cd apps/indexer && uv run pytest       # Python
```

---

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — full stack and design decisions
- [`docs/evals.md`](./docs/evals.md) — eval methodology, scoring, dataset schema
- [`docs/roadmap.md`](./docs/roadmap.md) — 6-phase build plan + Phase 7 proposed
- [`docs/prompts.md`](./docs/prompts.md) — prompt change log with eval deltas
- [`docs/adr/005-agent-runtime.md`](./docs/adr/005-agent-runtime.md) — Agent as production-grade runtime
- [`docs/adr/006-github-native-review-delivery.md`](./docs/adr/006-github-native-review-delivery.md) — CI-first GitHub delivery decision
- [`evals/datasets/v1/README.md`](./evals/datasets/v1/README.md) — dataset schema, full example list

## License

MIT
