---
inclusion: always
---

# Tech Stack

**Source of truth: `AGENTS.md` § 3.** This file mirrors the stack for Kiro's quick reference. If anything here conflicts with AGENTS.md, AGENTS.md wins.

## App layer

- **Monorepo**: pnpm workspaces + Turborepo
- **Web app**: Next.js 15 (App Router), React 19, TypeScript 5 strict
- **Styling**: Tailwind CSS 4 + shadcn/ui
- **Streaming**: Vercel AI SDK 5
- **Validation**: Zod 3

## Data

- **Database**: Postgres 16+ via Supabase
- **Vector**: pgvector with HNSW indexes
- **ORM**: Drizzle (not Prisma)
- **Auth**: Supabase Auth

## AI

- **Primary LLM**: Anthropic Claude (Sonnet for most, Opus for hard reviews)
- **Fallback LLM**: OpenAI
- **Embeddings**: Voyage `voyage-code-3` (1024-dim)
- **Reranker**: Cohere `rerank-3`
- **Sandbox**: E2B for executing untrusted code

## Python (indexer + evals)

- **Python**: 3.12+
- **Package manager**: `uv` — never `pip`
- **Lint/format**: Ruff (replaces black, isort, flake8)
- **Validation**: Pydantic v2
- **Code parsing**: tree-sitter

## Quality & ops

- **TS lint/format**: Biome (replaces ESLint + Prettier)
- **TS tests**: Vitest
- **E2E tests**: Playwright
- **Python tests**: pytest
- **Tracing**: Langfuse
- **Errors**: Sentry
- **Deploy**: Vercel (web app), Modal (Python jobs and GPU)

## Decided answers to common questions

| Q | A |
|---|---|
| Why not Prisma? | Drizzle is lighter, better TS inference, faster runtime. |
| Why not ESLint + Prettier? | Biome is one tool, much faster, near-feature-parity in 2026. |
| Why not LangChain / LlamaIndex? | Project's goal is to learn primitives. Frameworks come later, if at all. |
| Why not Pinecone / Qdrant? | pgvector is sufficient at this scale and cheaper. Postgres is already needed. |
| Why TS + Python both? | TS wins for app, Python wins for embeddings/eval/fine-tuning. Polyglot is realistic. |
| Why not OpenAI as primary? | Project demonstrates Claude integration (prompt caching, computer use, agent SDK familiarity). OpenAI as fallback gives comparison data. |

## Version policy

- Pin to the major versions listed above for the full project duration.
- Bump minors/patches freely.
- Major version bumps require an ADR (`docs/adr/`).

## Things to never add

- ❌ A second ORM
- ❌ A second styling framework
- ❌ Class components in React
- ❌ A second runtime validation library besides Zod (TS) or Pydantic (Python)
- ❌ A second test runner
