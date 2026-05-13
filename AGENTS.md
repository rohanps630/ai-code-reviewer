# AI Code Reviewer — Agent Instructions

You are working in the AI Code Reviewer monorepo. **Read this file in full before making any changes.** All conventions, structure, and constraints defined here apply across every AI coding tool (Kiro, Claude Code, Codex, Cursor, Aider, etc.).

---

## 1. What we're building

An AI agent that reviews GitHub pull requests using code-aware retrieval and tool use. Built as a portfolio project demonstrating production-grade AI integration engineering: hybrid retrieval, agentic loops, evals, observability, and cost optimization.

This is **not** a wrapper around `claude messages`. The interesting code is the retrieval pipeline, the agent loop, and the eval harness.

---

## 2. Current phase

**Phase 1 — Foundations**: scaffolding, infrastructure, end-to-end "paste diff, get streamed review" placeholder. No retrieval, no agent loop yet.

Update this section when phase changes. Phases:

1. Foundations (current)
2. RAG done right
3. Agents and tool use
4. Evals
5. Production concerns
6. (Optional) Fine-tuning

See `docs/roadmap.md` for full phase details.

---

## 3. Tech stack — exact choices

These are decided. Do not substitute without a written ADR in `docs/adr/`.

### App layer
- **Monorepo**: pnpm workspaces + Turborepo
- **Web app**: Next.js 15 (App Router) + React 19 + TypeScript 5 (strict)
- **Styling**: Tailwind CSS 4 + shadcn/ui
- **Streaming**: Vercel AI SDK 5
- **Validation**: Zod 3 at every external boundary

### Data
- **Database**: Postgres 16+ via Supabase
- **Vector**: pgvector with HNSW indexes
- **ORM**: Drizzle (not Prisma)
- **Auth**: Supabase Auth

### AI
- **Primary LLM**: Anthropic Claude (Sonnet/Opus)
- **Fallback LLM**: OpenAI
- **Embeddings**: Voyage `voyage-code-3`
- **Reranker**: Cohere `rerank-3`
- **Code sandbox**: E2B (when executing untrusted code)

### Indexer / evals (Python)
- **Python**: 3.12+
- **Package manager**: uv (never pip)
- **Lint/format**: Ruff
- **Validation**: Pydantic v2
- **Code parsing**: tree-sitter

### Quality / ops
- **Lint/format (TS)**: Biome (not ESLint + Prettier)
- **Tests**: Vitest (unit), Playwright (E2E), pytest (Python)
- **Tracing**: Langfuse
- **Errors**: Sentry
- **Deploy**: Vercel (web), Modal (Python jobs)

---

## 4. Folder structure

```
ai-code-reviewer/
├── apps/
│   ├── web/                    # Next.js 15 app
│   └── indexer/                # Python indexer + eval runner
├── packages/
│   ├── agent/                  # HAND-WRITTEN: loop, tools, prompts, retrieval
│   ├── db/                     # Drizzle schemas + migrations
│   └── shared/                 # Types + env loader
├── evals/
│   ├── datasets/               # Golden datasets (JSONL)
│   └── results/                # Eval run outputs
├── docs/
│   ├── architecture.md
│   ├── coding-style.md
│   ├── prompts.md              # Prompt change log
│   ├── evals.md
│   └── adr/                    # Architecture decision records
├── .claude/commands/           # Claude Code slash commands
├── .kiro/steering/             # Kiro steering files
└── AGENTS.md                   # ← this file (source of truth)
```

Full architecture details in `docs/architecture.md`.

---

## 5. Commands

```bash
# Setup
pnpm install                    # Install all JS deps
cd apps/indexer && uv sync      # Install Python deps

# Development
pnpm dev                        # Start web app
pnpm db:migrate                 # Run DB migrations
pnpm db:studio                  # Drizzle Studio

# Quality
pnpm typecheck                  # TS typecheck across workspace
pnpm lint                       # Biome lint
pnpm format                     # Biome format
pnpm test                       # Vitest + pytest

# Indexer / evals (Python)
cd apps/indexer
uv run python -m indexer.cli index <repo-url>
uv run python -m evals.cli run --dataset v1
```

---

## 6. Conventions

### TypeScript
- Strict mode: `strict: true`, `noUncheckedIndexedAccess: true`
- No `any`. No `as` casts without a `// why:` comment.
- Validate every external input through Zod (HTTP bodies, env, LLM outputs).
- Named exports only. No default exports.
- Absolute imports via `@/` alias. No `../../../`.
- Functions over classes unless state is essential.

### Python
- Type hints on every function signature.
- Pydantic v2 for cross-boundary data structures.
- `pathlib.Path` for all file paths.
- `uv add <pkg>` to add dependencies. Never `pip install`.

### File naming
| Thing | Convention |
|---|---|
| TS files | `kebab-case.ts` |
| React components | `PascalCase.tsx` |
| Python files | `snake_case.py` |
| DB tables | `snake_case`, plural |
| DB columns | `snake_case` |
| Env vars | `SCREAMING_SNAKE` |

### Prompts
- Prompts are **versioned artifacts**, like migrations.
- Live in `packages/agent/src/prompts/versions/system-vX.Y.ts`.
- Never edit a published version in place. Bump to next version.
- Log every change in `docs/prompts.md` with eval delta.

### Commits — Conventional Commits
```
<type>(<scope>): <summary>
```
Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `eval`.

### Branches
- `main` — protected, deployable
- `feat/<name>`, `fix/<name>`, `chore/<name>`, `eval/<name>`

---

## 7. Never do

These will be rejected in review every time. No exceptions.

- ❌ **Never modify `packages/agent/src/loop.ts`, `prompts/`, or `retrieval/`** unless the human explicitly asks. These are hand-authored and are the project's learning core.
- ❌ Never commit secrets or hardcode API keys.
- ❌ Never edit a published prompt version in place — bump to next version.
- ❌ Never write tests that assert on LLM output **content** directly. That's what evals are for. Mock LLMs only for shape/error tests.
- ❌ Never use `pip` or `pip install`. Use `uv`.
- ❌ Never use `npm` or `yarn`. Use `pnpm`.
- ❌ Never introduce a new dependency without justification in the PR description.
- ❌ Never disable typecheck or lint to ship faster.
- ❌ Never write code that bypasses Zod validation at API boundaries.
- ❌ Never commit `.env*` files (other than `.env.example`).

---

## 8. Where to find things

| You need | Look here |
|---|---|
| Architecture details | `docs/architecture.md` |
| Coding style deep dive | `docs/coding-style.md` |
| Prompt history | `docs/prompts.md` |
| Eval datasets and methodology | `docs/evals.md` |
| Active prompts | `packages/agent/src/prompts/versions/` |
| Agent tools | `packages/agent/src/tools/` |
| DB schemas | `packages/db/src/schema/` |
| Shared types | `packages/shared/src/types.ts` |
| Env validation | `packages/shared/src/env.ts` |
| ADRs | `docs/adr/` |

---

## 9. When in doubt

Stop and ask the human. Do not guess at architecture, do not write code that violates this document's structure, do not introduce frameworks not listed above. A clarifying question is always cheaper than a refactor.
