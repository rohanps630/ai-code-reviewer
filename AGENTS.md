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
├── scripts/                    # Repo-level tooling (interactive CLI, etc.)
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

# Interactive CLI — wraps everything below behind a numbered menu
pnpm cli                        # Run all dev/build/test/db tasks from one menu

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

The `pnpm cli` interactive menu (`scripts/cli.mjs`) is the preferred
entry point for routine work — it wraps every command in this section
plus the Git / Indexer flows. It's a tool we maintain, not a generated
artifact. **When you add a new top-level command (script, workflow,
common task), also add it to `scripts/cli.mjs`** so the menu stays a
faithful index. See § 6 → "Interactive CLI".

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

### Interactive CLI

`scripts/cli.mjs` (run via `pnpm cli`) is a hand-maintained Node CLI
that surfaces every routine task — dev, build, test, lint, db, indexer,
git — behind a numbered menu. It's zero-dep (Node 22+ stdlib only) and
deliberately easy to extend.

**Keep it in sync with the codebase.** Treat the CLI like any other
piece of source — it has to be updated alongside the work it wraps:

- Adding a new `package.json` script that humans will run? Add a
  matching entry to the relevant submenu in `tree`.
- Adding a new long-running task (dev server, watcher, studio)? Set
  `longRunning: true` so the menu prints the Ctrl-C hint.
- Adding a destructive task (clean, migrate, push, drop)? Set
  `confirm: "<one-sentence warning>"` so the menu prompts for
  confirmation.
- Renaming or removing a task? Update or remove its menu entry in
  the same commit.
- New top-level workflow (e.g. eval runner in Phase 4)? Add a new
  submenu rather than overloading an existing one.

The header docstring in `scripts/cli.mjs` documents the three item
shapes (`menu` / `run` / `action`) and every `run` option. Adding a
new entry is a single object literal — don't refactor the surrounding
machinery to fit a one-off command.

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
- ❌ Never let the `scripts/cli.mjs` menu fall out of sync with the actual scripts — add the entry in the same commit as the new command, don't defer it.

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
| Interactive task menu | `scripts/cli.mjs` (run with `pnpm cli`) |

---

## 9. When in doubt

Stop and ask the human. Do not guess at architecture, do not write code that violates this document's structure, do not introduce frameworks not listed above. A clarifying question is always cheaper than a refactor.
