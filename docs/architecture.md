# Architecture

> The definitive reference for how this project is structured. Updates here require a PR. Major changes require an ADR in `docs/adr/`.

## High-level

```
diff submitted ──▶ apps/web /api/reviews
                          │
                          ▼
                  packages/agent (Agent runtime → runReview)
                          │
                  ┌───────┼───────┬──────────────┐
                  ▼       ▼       ▼              ▼
              Postgres   LLM    Embed/Rerank   E2B
              (pgvector) (Claude) (Voyage/      sandbox
                                  Cohere)

Background (apps/indexer, Python; Modal deploy planned):
   repo clone ─▶ tree-sitter chunks ─▶ embeddings ─▶ Postgres
   PR replay  ─▶ agent run         ─▶ judge       ─▶ eval results (JSON)
```

> Note: PR ingestion today is a diff submitted through the web UI / `/api/reviews`.
> A GitHub-webhook entry point is planned, not yet implemented.

## Monorepo layout

```
ai-code-reviewer/
├── apps/
│   ├── web/                Next.js 16 app (UI + API + agent execution)
│   └── indexer/            Python worker: indexing, evals
├── packages/
│   ├── agent/              Protected: loop, tools, prompts, retrieval
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
│   │   │   └── repos/route.ts
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ui/                 # shadcn primitives (auto-generated)
│   │   └── features/           # Domain components (your code)
│   ├── lib/
│   │   ├── access-key.ts       # API access-key guard
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

## Where to put new code

| What you're adding | Where it goes |
|---|---|
| New API route | `apps/web/src/app/api/<name>/route.ts` |
| New page | `apps/web/src/app/(app)/<name>/page.tsx` |
| New UI component (generic) | `apps/web/src/components/ui/` |
| New UI component (domain) | `apps/web/src/components/features/<domain>/` |
| New DB table | `packages/db/src/schema/<name>.ts` + migration |
| New shared type | `packages/shared/src/types.ts` |
| New env var | `packages/shared/src/env.ts` Zod schema **and** `.env.example` |
| New Python indexer module | `apps/indexer/src/indexer/<name>.py` |
| New eval scorer | `apps/indexer/src/evals/scorers/<name>.py` |
| New agent tool | **STOP. Ask the human first** (`AGENTS.md` § 7). |
| New prompt version | **STOP. Ask the human first** (`AGENTS.md` § 7). |
| New ADR | `docs/adr/NNN-<slug>.md` (next number) |
| New top-level command | Add to `scripts/cli.mjs` `tree` **in the same commit** as the script |

## Version policy

- Pin to the major versions listed in `AGENTS.md` § 3 for the full
  project duration.
- Bump minors/patches freely.
- Major version bumps require an ADR in `docs/adr/`.

## The agent package

`packages/agent/` holds the agent loop, tools, prompts, and retrieval — the parts that change most often as the product evolves and that we want a human to own end-to-end. AI tools should not modify it without explicit human direction (see AGENTS.md § 7).

```
packages/agent/src/
├── agent.ts                # Agent runtime: typed stream() event loop, cost cap,
│                           #   abort, timeouts, tool concurrency, stopTool, hooks
├── agent-types.ts          # AgentEvent union, error taxonomy, hook/config types
├── models.ts               # Tier → model-id table + pricing (for the cost cap)
├── loop.ts                 # runReview: a thin specialization of Agent (ADR-005)
├── providers/              # Model-agnostic seam (anthropic/openai/google/groq/ollama)
├── tools/
│   ├── search-code.ts      # Hybrid retrieval over chunks
│   ├── read-file.ts        # Direct file read by path or symbol
│   ├── find-references.ts  # Symbol lookup (BM25 phrase match; real
│   │                       #   tree-sitter reference resolution planned)
│   ├── run-tests.ts        # E2B sandbox execution
│   ├── registry.ts         # Tool registry
│   └── index.ts            # Auto-aggregates exports
├── prompts/
│   ├── versions/
│   │   ├── system-v0.1.ts
│   │   ├── system-v0.2.ts
│   │   └── system-v0.3.ts  # CURRENT
│   └── index.ts            # Exports CURRENT version
├── retrieval/
│   ├── hybrid.ts           # BM25 + vector + rerank
│   ├── contextual.ts       # Contextual chunk prefixing
│   └── chunking.ts         # Tree-sitter AST-based chunking
└── types.ts
```

Key principles:

- **`Agent` is the runtime; `runReview` is a specialization** (ADR-005). The
  production loop lives in `agent.ts`: a declarative, model-agnostic class whose
  `stream()` drives a typed `AgentEvent` loop and owns the cross-cutting
  concerns — usage/cost accounting + spend cap, end-to-end `AbortSignal`
  cancellation, model/tool/run timeouts, tool-output truncation, a tool
  concurrency cap, structured termination via a `stopTool`, and lifecycle
  hooks. `loop.ts` configures one `Agent` (review system prompt, the review
  tools, `submit_review` as the stop tool, pricing from `models.ts`) and maps
  its events onto the public `ReviewChunk` stream. Add agentic capabilities to
  the runtime, not to `runReview`.
- **Tools are pure-ish**: input → output via Zod schemas. Side effects (DB, HTTP) are dependency-injected so tests can stub.
- **Termination is explicit**: the model calls `submit_review` (the stop tool),
  or the run hits `maxIterations`, the hard cost cap, a timeout, or an abort.
- **Prompts are versioned files**, never edited in place. See `docs/prompts.md`.
- **Retrieval is composable**: `searchCode(query)` runs BM25 + vector + rerank as separate steps you can inspect and replace.

## Data model

Schemas live in `packages/db/src/schema/`. **Tables that exist today:**

- `reviews` — one row per review request, with diff, output (jsonb), status,
  model, tokens, cost, and the Phase 5 cache columns (`cache_status`,
  `prompt_cache_tokens`)
- `repos` — connected GitHub repositories
- `documents` — files in indexed repos
- `chunks` — AST-aware chunks with embeddings (pgvector, HNSW index) and a
  generated `content_tsv` tsvector (GIN index) for BM25
- `semantic_cache` — cached responses by query embedding (HNSW index)

See `packages/db/src/schema/*.ts` for current column definitions.

**Planned (not yet in the schema):**

- `agent_runs` / `agent_steps` — persist each agent execution and every
  model/tool step with timing and cost, to power run/step replay. The runtime
  already emits a complete event stream (`packages/agent/src/agent-types.ts`);
  these tables are the persistence layer for it.
- `eval_*` tables — eval runs currently write to JSON under
  `evals/results/<run-id>/` rather than Postgres; a DB-backed eval store is a
  future option, not a current dependency.

## Streaming

- **Inside the agent loop**: the `Agent` runtime's `stream()` emits a typed
  `AgentEvent` sequence; `runReview` maps it onto a `ReviewChunk` stream.
- **Tool calls stream their state**: "Searching code…" → "Reading auth.ts…" → "Running tests…" → review output continues.
- **UI updates progressively**: tool state shown in a timeline, review markdown rendered in the main column.

The transport is newline-delimited JSON (`Content-Type: application/x-ndjson`)
over a streamed HTTP response from `/api/reviews` — not the Vercel AI SDK and
not raw WebSockets. The client parses chunks line-by-line
(`apps/web/src/components/features/reviews/use-review-stream.ts`).

> Note: the event stream is currently transient — it is rendered live but only
> the final review output is persisted. Per-step persistence + replay is the
> planned `agent_runs`/`agent_steps` work (see Data model).

## Retrieval pipeline (Phase 2+)

For each review:

1. **Query construction**: extract changed symbols from the diff; build queries per symbol + a general "what does this PR do" query
2. **BM25 search** in Postgres full-text index
3. **Vector search** in pgvector with HNSW
4. **Merge + dedupe** results (RRF — reciprocal rank fusion)
5. **Rerank** top candidates with Cohere `rerank-v3.5` (optional — skipped when `COHERE_API_KEY` is unset, in which case RRF order is used directly)
6. **Take top results** as context for the agent

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
4. Write per-example traces to `evals/results/<run-id>/raw/*.json`
5. Compute aggregates: mean scores, P50/P95 latency, total cost
6. Compare to most recent prior run, compute deltas (unless `--no-delta`)
7. Output `summary.json` to `evals/results/<run-id>/`

## Observability

- **Langfuse**: every LLM call traced, with tool call sub-spans, full I/O, latency, cost
- **Sentry**: exceptions in web app and Python jobs
- **Postgres**: per-review rows in `reviews` (model, status, tokens, cost, cache status) for SQL analysis. Per-step `agent_runs`/`agent_steps` logging is planned (see Data model).
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
- **`apps/indexer`** → Modal (cron-scheduled re-index + on-demand eval runs) — *planned; no Modal config in the repo yet. Indexer + evals run via the CLI locally / in CI today.*
- **Postgres** → Supabase (managed)
- **Cache** → Upstash Redis (serverless)

## Security boundaries

- **All external input validated through Zod** before reaching agent logic
- **API routes are guarded** by an access-key check (`x-access-key`) and per-IP rate limiting; GitHub webhook signature verification is planned alongside the webhook entry point
- **Code retrieved from repos is treated as untrusted content** — prompt injection defense applied (delimiters + sanitization of closing tags, instructional reminders in system prompt)
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
