# AI Code Reviewer

An AI agent that reviews GitHub pull requests using code-aware retrieval and tool use. Built as a portfolio project demonstrating production-grade AI integration engineering: hybrid retrieval (BM25 + vector + rerank), agentic loops, evals, observability, and cost optimization.

> **Status**: 🎉 Phase 5 — Production concerns (Completed)

## Demo

<!-- Add screenshot or Loom once Phase 1 ships -->

[Live demo](https://your-deploy-url.vercel.app) · [Blog post series](https://your-blog.com/ai-code-reviewer)

## What makes it interesting

- **Code-aware retrieval**: AST-based chunking with tree-sitter, hybrid BM25 + vector search via pgvector, cross-encoder reranking
- **Agentic loop**: Tool-using agent that searches code, reads files, finds references, runs tests with a clean ReAct-style control loop
- **Real evals**: Golden dataset of 50+ historical PRs from popular OSS repos, scored by LLM-as-judge plus deterministic checks
- **Production concerns**: Prompt caching, semantic caching, model routing, prompt injection defense, full Langfuse tracing

## Architecture

See [`docs/architecture.md`](./docs/architecture.md) for the full stack, folder structure, and design decisions.

```
apps/web         → Next.js 15 app
apps/indexer     → Python: indexing + evals
packages/agent   → Agent loop, tools, prompts, retrieval
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
added to the menu in the same commit (see `docs/guidelines.md` § 6 →
Interactive CLI).

### Run an eval

```bash
cd apps/indexer
uv run python -m evals.cli run --dataset v1
```

## Documentation

`docs/` is the shared **agent-context hub** — all maintained guidance lives there:

- [`docs/guidelines.md`](./docs/guidelines.md) — **Canonical** project guidelines (stack, structure, conventions, "never do" rules)
- [`docs/architecture.md`](./docs/architecture.md) — Full architecture
- [`docs/coding-style.md`](./docs/coding-style.md) — Code conventions
- [`docs/roadmap.md`](./docs/roadmap.md) — 6-phase build plan
- [`docs/prompts.md`](./docs/prompts.md) — Prompt change log
- [`docs/evals.md`](./docs/evals.md) — Eval methodology
- [`docs/adr/`](./docs/adr/) — Architecture decision records
- [`AGENTS.md`](./AGENTS.md) — Root pointer every AI tool resolves to → `docs/guidelines.md`

## Working with AI coding tools

This repo is set up so every AI coding tool reads the same conventions from one place:
**[`docs/guidelines.md`](./docs/guidelines.md)**. Tools reach it through a single chain —
tool shim → [`AGENTS.md`](./AGENTS.md) (root pointer) → `docs/guidelines.md`. None of the
pointer files carry unique guidance.

| Tool | Discovery file → |
|---|---|
| Claude Code | `CLAUDE.md` → `@AGENTS.md` |
| OpenAI Codex CLI / Amp / opencode / Zed / Windsurf / Roo / Junie / Antigravity | `AGENTS.md` (native) |
| Cursor | `.cursorrules` + `.cursor/rules/agents.mdc` → `AGENTS.md` |
| Kiro | `.kiro/steering/agents.md` → `#[[file:docs/guidelines.md]]` |
| Gemini CLI / Antigravity | `GEMINI.md` → `AGENTS.md` |
| GitHub Copilot | `.github/copilot-instructions.md` → `AGENTS.md` |
| Cline | `.clinerules/01-agents.md` → `AGENTS.md` |
| Aider | `CONVENTIONS.md` → `AGENTS.md` |

To add support for another agent, create its expected file at its
expected location, point it at `AGENTS.md`, and add a row to the table
in `docs/guidelines.md` § 9. See "Agent context — single source of truth"
there for the full policy.

## License

MIT
