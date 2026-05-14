# AI Code Reviewer

An AI agent that reviews GitHub pull requests using code-aware retrieval and tool use. Built as a portfolio project demonstrating production-grade AI integration engineering: hybrid retrieval (BM25 + vector + rerank), agentic loops, evals, observability, and cost optimization.

> **Status**: 🚧 Phase 1 — Foundations

## Demo

<!-- Add screenshot or Loom once Phase 1 ships -->

[Live demo](https://your-deploy-url.vercel.app) · [Blog post series](https://your-blog.com/ai-code-reviewer)

## What makes it interesting

- **Code-aware retrieval**: AST-based chunking with tree-sitter, hybrid BM25 + vector search via pgvector, cross-encoder reranking
- **Agentic loop**: Tool-using agent that searches code, reads files, finds references, runs tests — written from scratch, not LangChain-generated
- **Real evals**: Golden dataset of 50+ historical PRs from popular OSS repos, scored by LLM-as-judge plus deterministic checks
- **Production concerns**: Prompt caching, semantic caching, model routing, prompt injection defense, full Langfuse tracing

## Architecture

See [`docs/architecture.md`](./docs/architecture.md) for the full stack, folder structure, and design decisions.

```
apps/web         → Next.js 15 app
apps/indexer     → Python: indexing + evals
packages/agent   → Hand-written agent loop, tools, prompts, retrieval
packages/db      → Drizzle schemas
packages/shared  → Cross-app types
scripts/cli.mjs  → Interactive task menu (pnpm cli)
```

## Stack

- **Web**: Next.js 15, React 19, TypeScript 5, Tailwind 4, shadcn/ui, Vercel AI SDK
- **Data**: Postgres (Supabase) + pgvector, Drizzle ORM
- **AI**: Anthropic Claude (primary), OpenAI (fallback), Voyage `voyage-code-3` (embeddings), Cohere `rerank-3`
- **Python**: 3.12, uv, Ruff, Pydantic v2, tree-sitter
- **Ops**: Langfuse, Sentry, Vercel, Modal

## Getting started

### Prerequisites

- Node.js 22+ (`nvm use`)
- pnpm 9+
- Python 3.12+
- [uv](https://docs.astral.sh/uv/)
- A Supabase project with pgvector enabled
- API keys: Anthropic, Voyage, Cohere (see `.env.example`)

### Setup

```bash
# Install JS deps
pnpm install

# Install Python deps
cd apps/indexer && uv sync && cd ../..

# Copy env files
cp .env.example apps/web/.env.local
cp .env.example apps/indexer/.env

# Run migrations
pnpm db:migrate

# Start web app
pnpm dev
```

### Daily workflow

For routine tasks (dev server, build, test, lint, db, indexer, git),
use the interactive menu — it's faster than remembering script names
and confirms before anything destructive:

```bash
pnpm cli
```

The menu lives in [`scripts/cli.mjs`](./scripts/cli.mjs) and is
maintained alongside the code: any new top-level command should be
added to the menu in the same commit (see AGENTS.md § 6 → Interactive
CLI).

### Run an eval

```bash
cd apps/indexer
uv run python -m evals.cli run --dataset v1
```

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — Full architecture
- [`docs/coding-style.md`](./docs/coding-style.md) — Code conventions
- [`docs/roadmap.md`](./docs/roadmap.md) — 6-phase build plan
- [`docs/prompts.md`](./docs/prompts.md) — Prompt change log
- [`docs/evals.md`](./docs/evals.md) — Eval methodology
- [`docs/adr/`](./docs/adr/) — Architecture decision records
- [`AGENTS.md`](./AGENTS.md) — Instructions for AI coding tools

## Working with AI coding tools

This repo is set up to work with any AI coding tool. The conventions in `AGENTS.md` are read by Claude Code, OpenAI Codex, Cursor, Aider, and Kiro (via `.kiro/steering/`). Drop in any tool and it'll follow the same rules.

## License

MIT
