# Architecture

> The definitive reference for how this project is structured. Updates here require a PR. Major changes require an ADR in `docs/adr/`.

## High-level

```
GitHub webhook ──▶ apps/web /api/webhooks/github
                          │
                          ▼
                  packages/agent (loop)
                          │
                  ┌───────┼───────┬──────────────┐
                  ▼       ▼       ▼              ▼
              Postgres   LLM    Embed/Rerank   GitHub
              (pgvector) (Claude) (Voyage/      API
                                  Cohere)

Background (apps/indexer, Python on Modal):
   repo clone ─▶ tree-sitter chunks ─▶ embeddings ─▶ Postgres
   PR replay  ─▶ agent run         ─▶ judge       ─▶ eval results
```

## Monorepo layout

```
ai-code-reviewer/
├── apps/
│   ├── web/                Next.js 15 app (UI + API + agent execution)
│   └── indexer/            Python worker: indexing, evals
├── packages/
│   ├── agent/              Hand-written: loop, tools, prompts, retrieval
│   ├── db/                 Drizzle schemas + migrations
│   └── shared/             Cross-app types + env loader
├── evals/
│   ├── datasets/           Golden datasets (JSONL)
│   └── results/            Eval outputs (summaries committed, raw gitignored)
├── docs/                   This folder
├── scripts/                Repo-level tooling (interactive CLI, etc.)
├── .claude/commands/       Claude Code slash commands
├── .kiro/steering/         Kiro steering files
├── .github/                CI workflows + templates
└── AGENTS.md               Source of truth for AI coding tools
```

## `apps/web` layout

```
apps/web/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (marketing)/        # Public pages
│   │   ├── (app)/              # Authed pages
│   │   │   ├── repos/
│   │   │   ├── reviews/
│   │   │   └── settings/
│   │   ├── api/
│   │   │   ├── reviews/route.ts
│   │   │   └── webhooks/github/route.ts
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ui/                 # shadcn primitives (auto-generated)
│   │   └── features/           # Domain components (your code)
│   ├── lib/
│   │   ├── auth.ts
│   │   └── env.ts              # Re-exports from packages/shared
│   └── styles/
└── public/
```

## `apps/indexer` layout

```
apps/indexer/
├── src/
│   ├── indexer/                # Repo → chunks → embeddings → Postgres
│   │   ├── cli.py
│   │   ├── chunking.py
│   │   ├── embeddings.py
│   │   └── pipeline.py
│   ├── evals/                  # Golden dataset runner
│   │   ├── cli.py
│   │   ├── judge.py
│   │   └── scorers.py
│   └── shared/                 # Pydantic models, DB client, config
├── tests/
└── pyproject.toml
```

## The agent package

`packages/agent/` is the project's intellectual core. It's hand-written, learning-focused code. AI tools should not modify it without explicit human direction.

```
packages/agent/src/
├── loop.ts                 # The agent loop: model call → parse → tool call → repeat
├── tools/
│   ├── search-code.ts      # Hybrid retrieval over chunks
│   ├── read-file.ts        # Direct file read by path or symbol
│   ├── find-references.ts  # Symbol cross-references
│   ├── run-tests.ts        # E2B sandbox execution
│   ├── get-pr-discussion.ts
│   └── index.ts            # Registry, auto-aggregates exports
├── prompts/
│   ├── versions/
│   │   ├── system-v0.1.ts
│   │   ├── system-v0.2.ts
│   │   └── ...
│   └── index.ts            # Exports CURRENT version
├── retrieval/
│   ├── hybrid.ts           # BM25 + vector + rerank
│   ├── contextual.ts       # Contextual chunk prefixing
│   └── chunking.ts         # Tree-sitter AST-based chunking
└── types.ts
```

Key principles:

- **Tools are pure-ish**: input → output via Zod schemas. Side effects (DB, HTTP) are dependency-injected so tests can stub.
- **The loop is one function** with explicit termination conditions: stop_sequence reached, max_iterations exceeded, hard cost cap hit.
- **Prompts are versioned files**, never edited in place. See `docs/prompts.md`.
- **Retrieval is composable**: `searchCode(query)` runs BM25 + vector + rerank as separate steps you can inspect and replace.

## Data model

Schemas live in `packages/db/src/schema/`. Tables, with phase introduced:

### Phase 1
- `reviews` — one row per review request, with diff, output, model, tokens, cost

### Phase 2
- `repos` — connected GitHub repositories
- `documents` — files in indexed repos
- `chunks` — AST-aware chunks with embeddings (pgvector, HNSW index)

### Phase 3
- `agent_runs` — one per agent execution
- `agent_steps` — every model call and tool call, with timing and cost

### Phase 4
- `eval_datasets` — versioned datasets
- `eval_examples` — individual PRs with ground truth
- `eval_runs` — one per harness execution
- `eval_results` — per-example score in a run

### Phase 5
- `semantic_cache` — cached responses by query embedding
- Plus added columns on existing tables for cache hits, prompt cache tokens

See `packages/db/src/schema/*.ts` for current column definitions.

## Streaming

- **Inside the agent loop**: token streaming from Claude flows directly to the client via Vercel AI SDK's `streamText`.
- **Tool calls stream their state**: "Searching code…" → "Reading auth.ts…" → "Running tests…" → review output continues.
- **UI updates progressively**: tool state shown in a sidebar, review markdown rendered in the main column.

The streaming protocol used is Server-Sent Events via Vercel AI SDK's data stream. No raw WebSockets.

## Retrieval pipeline (Phase 2+)

For each review:

1. **Query construction**: extract changed symbols from the diff; build queries per symbol + a general "what does this PR do" query
2. **BM25 search** in Postgres full-text index
3. **Vector search** in pgvector with HNSW
4. **Merge + dedupe** results (RRF — reciprocal rank fusion)
5. **Rerank** top 30 with Cohere `rerank-3`
6. **Take top 10** as context for the agent

Implemented in `packages/agent/src/retrieval/hybrid.ts`.

## Indexing pipeline (apps/indexer)

For each connected repo:

1. **Clone shallow** to a temp dir
2. **Walk the file tree** with language detection
3. **Chunk by AST** using tree-sitter (per-language grammars)
4. **Generate contextual prefix** for each chunk via small Claude call
5. **Embed** with Voyage `voyage-code-3` (batched)
6. **Upsert into Postgres** with HNSW index maintenance

Reruns are incremental: only changed files re-chunk and re-embed.

## Eval harness (Phase 4)

For each eval run:

1. Load dataset version from `evals/datasets/<version>/examples.jsonl`
2. For each example: run the agent against the PR diff
3. Score with two judges:
   - **LLM-as-judge**: rubric-based score 0–1 with Claude Sonnet
   - **Deterministic**: did the agent's findings include the ground-truth issue? false-positive count?
4. Write per-example results to Postgres
5. Compute aggregates: mean scores, P50/P95 latency, total cost
6. Compare to most recent prior run, compute deltas
7. Output `summary.json` to `evals/results/<run-id>/`

## Observability

- **Langfuse**: every LLM call traced, with tool call sub-spans, full I/O, latency, cost
- **Sentry**: exceptions in web app and Python jobs
- **Postgres**: structured logs in `reviews` + `agent_runs` + `agent_steps` for SQL analysis
- **Vercel Analytics**: web app traffic and Core Web Vitals

## Caching layers

Three independent caches, each measured separately:

1. **Exact-match** — hash of full input, Upstash Redis, TTL 7d
2. **Semantic** — embedded query, cosine similarity > 0.95, Upstash Redis, TTL 1d
3. **Prompt caching** — Anthropic's built-in feature on static prompt prefixes (~90% input token reduction)

A request can hit zero, one, two, or all three. The `cache_status` column on `reviews` records which fired.

## Model routing

Phase 5 adds a small router that picks model based on PR signal:

- **Trivial** (diff < 50 lines, single file, no API surface change) → `claude-haiku-4-5`
- **Standard** → `claude-sonnet-4-7`
- **Complex** (large diff, multiple files, public API changes) → `claude-opus-4-7`

Routing logic is rule-based in `packages/agent/src/loop.ts`. No ML classifier needed at this scale.

## Developer tooling — `scripts/cli.mjs`

A zero-dep Node 22 interactive CLI lives at `scripts/cli.mjs` (run with
`pnpm cli`). It surfaces every routine task — dev server, build,
test, lint, typecheck, DB migrations, Drizzle Studio, indexer, git —
behind a numbered, color-coded menu. Each item is one of three shapes
(submenu, shell command, or inline action) and the file is intentionally
small so adding a new entry is a one-object-literal change.

The CLI is a maintained part of the codebase, not a generated artifact.
Any time we add a top-level `package.json` script, a Python task that
humans run, or a destructive operation, we add the matching entry to
the `tree` constant in the same commit. Destructive actions
(`clean`, `db migrate`, `git push`) get a `confirm:` warning; long-
running tasks (dev server, Drizzle Studio) get `longRunning: true`
which prints a Ctrl-C hint and returns to the menu when the child
exits. The same rule lives in `AGENTS.md` § 6 → "Interactive CLI" and
§ 7's never-do list.

## Deployment

- **`apps/web`** → Vercel (auto-deploy on `main` push)
- **`apps/indexer`** → Modal (cron-scheduled re-index + on-demand eval runs)
- **Postgres** → Supabase (managed)
- **Cache** → Upstash Redis (serverless)

## Security boundaries

- **All external input validated through Zod** before reaching agent logic
- **GitHub webhook signature verified** before processing
- **Code retrieved from repos is treated as untrusted content** — prompt injection defense applied (delimiters, instructional reminders in system prompt)
- **E2B sandbox** for any tool that executes code; nothing runs on app servers
- **No secrets in logs** — Langfuse and Sentry both scrub known env var names
- **Read-only DB user** for analytics queries

## Things explicitly excluded

These are out of scope for this project:

- ❌ Multi-tenant team/org features beyond personal use
- ❌ Real-time collaboration on reviews
- ❌ Browser extension
- ❌ IDE plugins
- ❌ Self-hosted deployment guide
- ❌ Multi-region failover
