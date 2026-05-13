# 001 — Stack choices

**Status**: Accepted
**Date**: 2026-05-13
**Deciders**: Project author

## Context

Starting a portfolio project to demonstrate AI integration engineering. Need to pick a stack that's:

1. Production-credible (interviewer-ready, not a toy)
2. Modern but stable (no bleeding-edge bets)
3. Plays to the author's full-stack background
4. Polyglot where each language has a clear win
5. Cheap to run during development

## Decision

### App layer: TypeScript + Next.js 15 + Tailwind 4 + shadcn/ui

- Next.js App Router for server components, server actions, streaming
- Tailwind 4 stable, faster engine, fewer config foot-guns
- shadcn/ui for copy-paste components — no runtime dependency

### Data: Postgres (Supabase) + pgvector + Drizzle

- Single database for relational and vector data
- pgvector is sufficient at this scale; avoids a second hosted service
- Drizzle over Prisma: lighter, faster, better TS inference, simpler migrations

### AI: Claude primary, OpenAI fallback, Voyage embeddings, Cohere rerank

- Claude for the main loop — strong coding ability, native prompt caching, agent SDK familiarity
- Voyage `voyage-code-3` beats OpenAI embeddings on code benchmarks
- Cohere `rerank-3` is the simplest path to a quality cross-encoder rerank

### Indexer / evals: Python with uv + Ruff + Pydantic v2

- Python wins for tree-sitter, embedding pipelines, and any future fine-tuning
- uv replaces pip + virtualenv + pip-tools
- Ruff replaces black + isort + flake8

### Tooling: Biome, Vitest, Lefthook, Turborepo, pnpm

- Biome over ESLint + Prettier: one tool, faster, near feature parity
- Lefthook over Husky: no Node dependency, written in Go
- Turborepo for monorepo task graph
- pnpm for workspace + speed

### Ops: Vercel + Modal + Langfuse + Sentry

- Vercel for the web app (zero-config Next.js deploys)
- Modal for Python jobs and GPU (best DX for ML compute)
- Langfuse for LLM tracing (open source, self-hostable)
- Sentry for errors (mature, free tier sufficient)

## Consequences

### Positive

- ✅ Stack-wide consistency: one ORM, one validation lib per language, one linter
- ✅ Bills stay low: pgvector instead of Pinecone, Supabase free tier, Langfuse free tier
- ✅ Polyglot is realistic for the role being interviewed for
- ✅ Every choice has interviewer talking points

### Negative

- ⚠️ Bet on relatively young Biome — if rules need extending, may hit limits
- ⚠️ Drizzle is less battle-tested than Prisma at enterprise scale
- ⚠️ pgvector at very large scale eventually loses to specialized vector DBs (not relevant here)

### Neutral

- TS + Python polyglot adds context-switching overhead but is genuinely the right shape

## Alternatives considered

### Pure Python (FastAPI + Jinja or HTMX)

Rejected. Loses the modern frontend story that's the author's existing strength.

### Pure TypeScript (including indexer)

Rejected. tree-sitter bindings, embedding pipelines, and future fine-tuning are all friction in TS. The polyglot setup is more honest.

### LangChain / LlamaIndex everywhere

Rejected. Project's explicit goal is to learn primitives. Frameworks come later (Phase 3 comparison only), if at all.

### Prisma over Drizzle

Rejected. Prisma is fine but heavier, slower, and Drizzle's TS-native API better fits a TS-first project.

### Pinecone / Qdrant / Weaviate

Rejected. pgvector is sufficient at this scale and avoids a second hosted dependency. Cost matters during a portfolio project.

## References

- [Anthropic — Contextual Retrieval blog post](https://www.anthropic.com/news/contextual-retrieval)
- [Voyage AI code embedding benchmarks](https://blog.voyageai.com/2024/12/04/voyage-code-3/)
- [Biome 1.0 announcement](https://biomejs.dev/blog/biome-v1/)
- [Drizzle vs Prisma comparison](https://orm.drizzle.team/docs/overview)
