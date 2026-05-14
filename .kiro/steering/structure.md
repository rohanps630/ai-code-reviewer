---
inclusion: always
---

# Project Structure

**Source of truth: `AGENTS.md` § 4.** This file gives Kiro the full folder map with guidance on where to put new code.

## Top-level layout

```
ai-code-reviewer/
├── apps/
│   ├── web/                    # Next.js 15 web app (UI + API + agent execution)
│   └── indexer/                # Python worker: indexing, embeddings, evals
├── packages/
│   ├── agent/                  # HAND-WRITTEN. Do not modify unless asked.
│   ├── db/                     # Drizzle schemas + migrations
│   └── shared/                 # Cross-app types + env loader
├── evals/
│   ├── datasets/               # Golden datasets (JSONL)
│   └── results/                # Eval run outputs (gitignored except summaries)
├── docs/
│   ├── architecture.md
│   ├── coding-style.md
│   ├── prompts.md
│   ├── evals.md
│   └── adr/                    # Architecture decision records
├── .claude/commands/           # Claude Code slash commands
├── .kiro/
│   ├── steering/               # This folder
│   └── specs/                  # Spec-driven dev specs
├── scripts/
│   └── cli.mjs                 # Interactive task menu (pnpm cli)
├── .github/
│   ├── workflows/
│   └── PULL_REQUEST_TEMPLATE.md
└── AGENTS.md                   # Source of truth
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

## `packages/agent` layout — PROTECTED

```
packages/agent/
└── src/
    ├── loop.ts                 # ⚠️ Hand-written agent loop
    ├── tools/                  # ⚠️ Hand-written tool definitions
    ├── prompts/
    │   ├── versions/           # ⚠️ Versioned prompts (never edit in place)
    │   └── index.ts            # Exports current version
    ├── retrieval/              # ⚠️ Hand-written retrieval logic
    └── types.ts
```

⚠️ = do not modify without explicit human instruction.

## Where to put new code

| What you're adding | Where it goes |
|---|---|
| New API route | `apps/web/src/app/api/<name>/route.ts` |
| New page | `apps/web/src/app/(app)/<name>/page.tsx` |
| New UI component (generic) | `apps/web/src/components/ui/` |
| New UI component (domain) | `apps/web/src/components/features/<domain>/` |
| New DB table | New file under `packages/db/src/schema/`, then migration |
| New shared type | `packages/shared/src/types.ts` |
| New env var | Add to `packages/shared/src/env.ts` Zod schema + `.env.example` |
| New Python indexer module | `apps/indexer/src/indexer/<name>.py` |
| New eval scorer | `apps/indexer/src/evals/scorers/<name>.py` |
| New agent tool | **STOP. Ask the human first.** |
| New prompt version | **STOP. Ask the human first.** |
| New ADR | `docs/adr/NNN-<slug>.md` (next number) |
| New top-level command | `scripts/cli.mjs` `tree` entry — in the same commit as the script |

## Naming

| Thing | Convention | Example |
|---|---|---|
| TS files | `kebab-case.ts` | `review-stream.ts` |
| React components | `PascalCase.tsx` | `ReviewPanel.tsx` |
| Python files | `snake_case.py` | `chunk_code.py` |
| DB tables | `snake_case`, plural | `agent_steps` |
| DB columns | `snake_case` | `created_at` |
| Env vars | `SCREAMING_SNAKE` | `ANTHROPIC_API_KEY` |
| Branches | `<type>/<slug>` | `feat/streaming-review` |

## Imports

- Absolute imports via `@/` alias inside an app.
- Cross-package imports via the package name (`@acr/agent`, `@acr/db`).
- No deep relative paths (`../../../`). Set up path aliases instead.
