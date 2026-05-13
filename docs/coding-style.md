# Coding Style

> Style rules for this project. Enforced by Biome (TS), Ruff (Python), and code review. AGENTS.md § 6 is the short version; this is the long version.

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

### Functions vs classes

- Functions by default.
- Classes only when state has invariants that benefit from encapsulation (e.g. a connection pool wrapper).
- Never use classes for "organization" — that's what modules are for.

### Validation at boundaries

Every value entering trusted code from an untrusted source passes through Zod:

- HTTP request bodies
- HTTP query strings
- Environment variables (validated once at startup via `packages/shared/src/env.ts`)
- LLM tool-call arguments (Zod schema attached to each tool)
- LLM final outputs that we'll act on
- Webhook payloads
- Data loaded from external APIs

```ts
const Body = z.object({ repoUrl: z.string().url(), prNumber: z.number().int() });
const parsed = Body.safeParse(await req.json());
if (!parsed.success) return Response.json({ error: parsed.error }, { status: 400 });
```

### Errors

- Throw `Error` (or subclasses) for genuine exceptional cases.
- Return a typed `Result<T, E>` (or a discriminated union) for known-failure-mode operations like "fetch this commit, might 404."
- Catch narrowly. Never `catch (e: any)` — Biome will yell.
- Always log the underlying cause; never swallow.

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

### Async

- Top-level `await` in route handlers is fine.
- Use `Promise.all` for independent operations. Don't sequentially await what could be parallel.
- Always `await` or `void` a promise. No floating promises.

### React (App Router)

- Server Components by default. Add `"use client"` only when you need state, effects, or browser APIs.
- Server Actions for mutations from forms.
- No `useEffect` for data fetching — fetch in Server Components or Server Actions.
- Components: PascalCase filenames, named export of the same name.
- Props: typed inline for small components, separate `Props` type for larger ones.
- Avoid `useMemo` / `useCallback` unless profiling shows a need.

### Tailwind

- Use the `cn` helper (clsx + twMerge) for conditional classes.
- Sort classes via Biome's `useSortedClasses` (configured).
- No arbitrary values when a design token will do.
- shadcn/ui components live in `apps/web/src/components/ui/`. Don't edit them lightly — they regenerate.

### Comments

- Comments explain **why**, not what.
- Public exports: JSDoc with at least a one-line description and an `@example`.
- `// TODO(name, YYYY-MM-DD): ...` — never anonymous TODOs.
- `// HACK: ...` is allowed as a brief admission; long explanations belong in a linked GitHub issue.

## Python

### Type hints

- Required on every function signature including return types.
- Use `from __future__ import annotations` at the top of files using forward refs heavily.
- Prefer `list[int]` over `List[int]` (Python 3.12+).
- `Annotated` is fine when adding metadata; don't overuse it.

### Pydantic v2

- All cross-module data structures are Pydantic models.
- Use `model_config = ConfigDict(frozen=True)` for immutable models.
- Use `Field(..., description="...")` so models self-document.

### Style

- Ruff config in `apps/indexer/pyproject.toml`. Run `uv run ruff format` and `uv run ruff check --fix`.
- Line length: 100.
- Snake_case files, snake_case functions, PascalCase classes, SCREAMING_SNAKE constants.

### Errors

- Catch narrowly. `except Exception:` is a red flag.
- Reraise with `raise ... from e` to preserve cause.
- Don't swallow — log and reraise, or handle specifically.

### Paths

- `pathlib.Path` always. Never raw strings for file paths.

### Dependencies

- `uv add <pkg>` to install. Never `pip install`.
- `uv add --dev <pkg>` for dev deps.
- Lock file (`uv.lock`) is committed.

## Tests

### What to test

- Pure functions: yes
- Parsing, chunking, prompt builders: yes
- Database queries: integration tests against a real local Postgres (test DB)
- LLM-output behavior: **no** — that's what evals are for
- LLM-output shape and error paths: yes (mock the LLM)
- UI components: light snapshot tests if they're complex; Playwright for full flows

### Structure

- TS: `<source>.test.ts` co-located, or `tests/` directory mirror
- Python: `tests/` directory mirroring `src/`
- One assertion per test in spirit. Multiple `expect` calls fine if they cover the same logical behavior.

### Naming

- `it("returns null when the repo is private")`
- Not `it("works")`, not `it("test repo")`.

## Git

### Conventional Commits

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types and when to use them:

| Type | Use for |
|---|---|
| `feat` | New user-visible capability |
| `fix` | Bug fix |
| `refactor` | Code change with no behavior change |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `docs` | Documentation only |
| `chore` | Build, tooling, deps |
| `eval` | Eval dataset or harness changes |
| `build` | Build system changes |
| `ci` | CI config changes |

### Subject line

- Imperative mood: "add", "fix", "rename" — not "added", "fixes"
- Lowercase
- No trailing period
- Under 72 chars

### Body

- Wrap at 72 chars
- Explain **why**, not what (the diff shows what)
- Reference issues: `Closes #123`

### Branches

- `feat/<short-slug>`
- `fix/<short-slug>`
- `chore/<short-slug>`
- `eval/<short-slug>` — triggers eval workflow
- `docs/<short-slug>`

## Naming patterns

### IDs

- All entity IDs are UUIDs, server-generated
- Foreign key columns: `<table_singular>_id`
- Don't expose sequential IDs in URLs

### Times

- Always store as `timestamptz` (UTC)
- Column names: `created_at`, `updated_at`, `<event>_at` (e.g. `indexed_at`)

### Booleans

- Predicate names: `is_<x>`, `has_<x>`, `should_<x>`
- Avoid double negatives (`is_not_disabled`)

### Money

- Always store as `numeric` (never `float`)
- Column suffix: `_usd` (or whatever currency)

## Things we don't do

- ❌ Barrel files (`index.ts` re-exports) except where genuinely needed for public API
- ❌ Lodash — use native JS / TS in 2026
- ❌ Moment.js / day.js — use native `Intl` and `Temporal` (when available) or `date-fns` if needed
- ❌ axios — use `fetch`
- ❌ Class components in React
- ❌ Redux / Zustand for server state — use React Query / Server Components
- ❌ CSS-in-JS — Tailwind only
- ❌ Notebooks in main — keep under `notebooks/` and gitignore by default
