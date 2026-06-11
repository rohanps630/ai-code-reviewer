# AI Code Reviewer — Project Guidelines (canonical agent context)

> **This file is the single source of truth for every AI coding tool.** It lives in the `docs/`
> hub; each tool reaches it via the root **`AGENTS.md`** pointer (and the tool-specific shims that
> point at `AGENTS.md`). Edit conventions, stack, "never do" rules, and structure **here** — never in
> a shim. Section numbers (`§ N`) below are stable and are referenced by ADRs, slash commands, and
> other docs.

You are working in the AI Code Reviewer monorepo. **Read this file in full before making any changes.** All conventions, structure, and constraints defined here apply across every AI coding tool (Kiro, Claude Code, Codex, Cursor, Aider, etc.).

---

## 1. What we're building

An AI agent that reviews GitHub pull requests using code-aware retrieval and tool use. Built as a portfolio project demonstrating production-grade AI integration engineering: hybrid retrieval, agentic loops, evals, observability, and cost optimization.

This is **not** a wrapper around `claude messages`. The interesting code is the retrieval pipeline, the agent loop, and the eval harness.

---

## 2. Current phase

**Phases 1–5 complete.** The project is in a production-ready state.

1. Foundations ✅
2. RAG done right ✅
3. Agents and tool use ✅
4. Evals ✅
5. Production concerns ✅
6. Fine-tuning — archived (see `docs/roadmap.md`)

See `docs/roadmap.md` for full phase details.

---

## 3. Tech stack — exact choices

These are decided. Do not substitute without a written ADR in `docs/adr/`.

### App layer
- **Monorepo**: pnpm workspaces + Turborepo
- **Web app**: Next.js 16 (App Router) + React 19 + TypeScript 5 (strict)
- **Styling**: Tailwind CSS 4 + shadcn/ui
- **Validation**: Zod 3 at every external boundary

### Data
- **Database**: Postgres 16+ via Supabase
- **Vector**: pgvector with HNSW indexes
- **ORM**: Drizzle (not Prisma)
- **Auth**: API access-key gate today (`x-access-key`, see `apps/web/src/lib/access-key.ts`); Supabase Auth is the planned end-state, not yet implemented

### AI
- **Primary LLM**: Anthropic Claude (Sonnet/Opus)
- **Fallback LLM**: OpenAI
- **Embeddings**: Voyage `voyage-code-3`
- **Reranker**: Cohere `rerank-v3.5` (optional — used when `COHERE_API_KEY` is set)
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
- **Deploy**: Vercel (web). Modal (Python jobs) is planned — no Modal config in the repo yet; the indexer + evals run via the CLI locally / in CI today.

---

## 4. Folder structure

```
ai-code-reviewer/
├── apps/
│   ├── web/                    # Next.js 16 app
│   └── indexer/                # Python indexer + eval runner
├── packages/
│   ├── agent/                  # PROTECTED: loop, tools, prompts, retrieval
│   ├── db/                     # Drizzle schemas + migrations
│   └── shared/                 # Types + env loader
├── evals/
│   ├── datasets/               # Golden datasets (JSONL)
│   └── results/                # Eval run outputs
├── docs/                       # ← shared agent-context hub (all maintained .md)
│   ├── guidelines.md           # ← THIS FILE — canonical project guidelines/steering
│   ├── architecture.md
│   ├── coding-style.md
│   ├── prompts.md              # Prompt change log
│   ├── evals.md
│   ├── roadmap.md
│   └── adr/                    # Architecture decision records
├── scripts/                    # Repo-level tooling (interactive CLI, etc.)
├── .claude/commands/           # Claude Code slash commands
├── .kiro/steering/agents.md    # Kiro pointer → docs/guidelines.md
└── AGENTS.md                   # Root pointer every AI tool resolves to → docs/guidelines.md
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

Coding conventions and stack-specific rules have been extracted to the new standards layer.
Please refer to [`standards/coding-conventions.md`](../standards/coding-conventions.md).

---

## 7. Never do

Hard constraints for the system have been extracted to the new standards layer.
Please refer to [`standards/never-do.md`](../standards/never-do.md).

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
| Where to put new code | `docs/architecture.md` → "Where to put new code" |
| Version policy | `docs/architecture.md` → "Version policy" |
| Interactive task menu | `scripts/cli.mjs` (run with `pnpm cli`) |

---

## 9. Agent context — single source of truth

**This file (`docs/guidelines.md`) is the canonical project context for
every AI coding tool.** It lives in the `docs/` hub — the one folder
that holds all maintained agent-context markdown (these guidelines,
architecture, coding-style, roadmap, evals, prompts, ADRs). Every tool
reaches it through a single chain:

```
tool-specific shim  →  AGENTS.md (root pointer)  →  docs/guidelines.md (canonical)
```

Most modern agents read a root `AGENTS.md` **natively** (the agents.md
standard), so `AGENTS.md` is the universal entry point; it points here.
A few tools need their own pointer file. Both groups are tracked below.

**Reads `AGENTS.md` natively (no shim needed):** OpenAI Codex CLI,
Sourcegraph Amp, opencode, Zed, Windsurf/Cascade, Roo Code, JetBrains
Junie, Google Antigravity, and the GitHub Copilot coding agent.

**Wired via a thin pointer file (all resolve to `AGENTS.md` → here):**

| Tool | Discovery file | What's in it |
|---|---|---|
| Claude Code | `CLAUDE.md` | `@AGENTS.md` (import; resolves transitively to `docs/guidelines.md`) |
| OpenAI Codex CLI | `AGENTS.md` | Reads the root pointer natively |
| Cursor | `.cursorrules` (legacy) + `.cursor/rules/agents.mdc` (`alwaysApply: true`) | Pointer to `AGENTS.md`; modern `.mdc` is the current format |
| Kiro | `.kiro/steering/agents.md` | `inclusion: always` + `#[[file:...]]` imports of `docs/guidelines.md` and key docs |
| Gemini CLI / Antigravity | `GEMINI.md` | Pointer + `@AGENTS.md` import (Antigravity also reads `AGENTS.md` natively) |
| GitHub Copilot (VS Code) | `.github/copilot-instructions.md` | One paragraph pointing to `AGENTS.md` |
| Cline | `.clinerules/01-agents.md` | Pointer (Cline doesn't auto-load root `AGENTS.md`) |
| Aider | `CONVENTIONS.md` | Pointer; load with `aider --read AGENTS.md` or `.aider.conf.yml` `read:` |

**Rules for keeping this honest:**

1. Project conventions, stack choices, "never do" rules, folder layout,
   commit format, prompt-versioning policy → **always edit
   `docs/guidelines.md`** (this file), never the root pointer or a shim.
2. Deeper detail lives beside this file in the `docs/` hub:
   architecture → `docs/architecture.md`, coding style →
   `docs/coding-style.md`, ADRs → `docs/adr/`.
3. The root `AGENTS.md` and the tool-specific files (`CLAUDE.md`,
   `.cursorrules`, `.cursor/rules/*`, `.kiro/steering/*`, `GEMINI.md`,
   `.github/copilot-instructions.md`, `.clinerules/*`, `CONVENTIONS.md`,
   `.aider.conf.yml`)
   exist only so each agent's discovery mechanism resolves to this
   canonical content. Do not put unique guidance in any of them.
4. Adding support for a new agent? Create the tool's expected file at
   its expected location, make it a thin pointer to `AGENTS.md` (which
   already points here), and record the entry in the table above.

If the answer to "should this rule live in `docs/guidelines.md` or in a
tool shim?" is ever ambiguous, the answer is `docs/guidelines.md`.

---

## 10. When in doubt

Stop and ask the human. Do not guess at architecture, do not write code that violates this document's structure, do not introduce frameworks not listed above. A clarifying question is always cheaper than a refactor.
