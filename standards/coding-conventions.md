# Coding Standards

> Style rules for this project. Enforced by Biome (TS), Ruff (Python), and code review.

## TypeScript

### Strictness
- `strict: true` plus `noUncheckedIndexedAccess: true` plus `noImplicitOverride: true`
- No `any`. If a third-party type is missing, write a declaration in `types/` rather than escape-hatching with `any`.
- No `as` casts without a `// why:` comment explaining what guarantees safety.
- `as const` is fine and encouraged for literal narrowing.

### Modules
- Named exports only. Default exports are reserved for files Next.js demands them (route handlers, pages, layouts) — Biome's override handles this.
- One responsibility per file. If a file grows past ~300 lines, look for a split.
- Absolute imports via `@/` inside an app. Cross-package via the package name (`@acr/db`).
- No deep relative paths (`../../../`) — set up a path alias instead.

### Functions vs classes
- Functions by default.
- Classes only when state has invariants that benefit from encapsulation (e.g. a connection pool wrapper).
- Never use classes for "organization" — that's what modules are for.
- Define agents declaratively using the custom `Agent` class to keep the orchestrator logic cleanly encapsulated:
  ```typescript
  const agent = new Agent({
    model: "claude-3-5-sonnet-20241022",
    tools: [searchCode, readFile],
    systemPrompt: "..."
  });
  const response = await agent.run("instruction");
  ```

### Validation at boundaries
Every value entering trusted code from an untrusted source passes through Zod:
- HTTP request bodies and query strings
- Environment variables (validated once at startup via `packages/shared/src/env.ts`)
- LLM tool-call arguments and final outputs
- Webhook payloads
- Data loaded from external APIs

### Errors
- Throw `Error` (or subclasses) for genuine exceptional cases.
- Return a typed `Result<T, E>` (or a discriminated union) for known-failure-mode operations.
- Catch narrowly. Never `catch (e: any)` — Biome will yell.
- Always log the underlying cause; never swallow.

### Async
- Top-level `await` in route handlers is fine.
- Use `Promise.all` for independent operations. Don't sequentially await what could be parallel.
- Always `await` or `void` a promise. No floating promises.

### React (App Router)
- Server Components by default. Add `"use client"` only when you need state, effects, or browser APIs.
- Server Actions for mutations from forms.
- No `useEffect` for data fetching — fetch in Server Components or Server Actions.
- Components: PascalCase filenames, named export of the same name.

### Tailwind
- Use the `cn` helper (clsx + twMerge) for conditional classes.
- Sort classes via Biome's `useSortedClasses`.
- No arbitrary values when a design token will do.

### Comments
- Comments explain **why**, not what.
- Public exports: JSDoc with at least a one-line description and an `@example`.
- `// HACK: ...` is allowed as a brief admission; long explanations belong in a linked GitHub issue.

## Python

### Type hints
- Required on every function signature including return types.
- Use `from __future__ import annotations` at the top of files using forward refs heavily.
- Prefer `list[int]` over `List[int]` (Python 3.12+).

### Pydantic v2
- All cross-module data structures are Pydantic models.
- Use `model_config = ConfigDict(frozen=True)` for immutable models.

### Style
- Ruff config in `apps/indexer/pyproject.toml`.
- Line length: 100.
- Snake_case files, snake_case functions, PascalCase classes, SCREAMING_SNAKE constants.

### Errors
- Catch narrowly. `except Exception:` is a red flag.
- Reraise with `raise ... from e` to preserve cause.

### Paths
- `pathlib.Path` always. Never raw strings for file paths.

### Dependencies
- `uv add <pkg>` to install. Never `pip install`.
- Lock file (`uv.lock`) is committed.

## Prompts & AI
- Prompts are **versioned artifacts**. Never edit a published version in place. Bump to the next version.
- Log every change in `docs/prompts.md` with eval delta. (See `contracts/prompt-versioning.md`).

## File Naming
| Thing | Convention |
|---|---|
| TS files | `kebab-case.ts` |
| React components | `PascalCase.tsx` |
| Python files | `snake_case.py` |
| DB tables | `snake_case`, plural |
| DB columns | `snake_case` |
| Env vars | `SCREAMING_SNAKE` |

## Git & Commits
- Use Conventional Commits: `<type>(<scope>): <summary>`
- Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `eval`, `build`, `ci`.
- Branches: `main` (protected), `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `eval/<slug>`, `docs/<slug>`.
- Explain **why** in the commit body.

## Architecture & Code Placement
- See `architecture/components.yaml` for structural boundaries.
- Two hard rules carry over here: new agent tools and new prompt versions require an explicit human ask (see `never-do.md`).
- Version Policy: Pin to major versions explicitly listed. Minor/patch bumps are free; major bumps require an ADR.

## Interactive CLI
`scripts/cli.mjs` (run via `pnpm cli`) surfaces every routine task.
**Keep it in sync with the codebase.** Treat the CLI like any other piece of source — it has to be updated alongside the work it wraps.

## Things we don't do
- ❌ Barrel files (`index.ts` re-exports) except where genuinely needed for public API
- ❌ Lodash — use native JS / TS
- ❌ Moment.js / day.js — use native `Intl` and `Temporal` or `date-fns`
- ❌ axios — use `fetch`
- ❌ Class components in React
- ❌ CSS-in-JS — Tailwind only
