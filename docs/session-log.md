# Session Log

## Phase 1 takeover — 2026-05-14

**What we're building**: An AI agent that reviews GitHub pull requests using
code-aware retrieval and tool use, shipped as a portfolio project.

**Current task state on takeover**:
- Tasks 1–4 complete (24/24 tests passing), staged but uncommitted
- Task 5 (apps/web Next.js 15 init) mostly done by Kiro, needed closeout
- Tasks 6–10 not started

**Protected paths (will not edit without explicit ask)**:
- `packages/agent/src/loop.ts`
- `packages/agent/src/prompts/` (any file, including versions)
- `packages/agent/src/retrieval/` (any file)
- Published prompt versions — only bump, never edit in place

**"Never do" rules (from AGENTS.md § 7)**:
- No edits to protected `packages/agent/` paths without explicit instruction
- No secrets / hardcoded API keys
- No editing published prompt versions in place
- No tests asserting LLM output content (that's evals)
- No `pip` (use `uv`), no `npm`/`yarn` (use `pnpm`)
- No new deps without justification
- No disabling typecheck/lint to ship faster
- No bypassing Zod validation at API boundaries
- No committing `.env*` files (except `.env.example`)

**Plan for finishing Phase 1**:
1. Task 5 closeout: verify pre-task corrections, biome auto-fix, run all
   quality gates, audit `apps/web/package.json`, boot test, fix pre-commit
   hook (install gitleaks), commit.
2. Task 6: env loader + Sentry + Langfuse wiring in `apps/web`.
3. Task 7: `/api/reviews` streaming route via Vercel AI SDK 5 + Anthropic SDK
   (placeholder review path catching agent's `Not implemented`).
4. Task 8: minimal UI — paste-diff form (`/reviews/new`), list (`/reviews`),
   detail (`/reviews/[id]`).
5. Task 9: `apps/indexer` Python scaffold (uv, ruff, pytest, stub CLIs).
6. Task 10: CI green — clean install, all checks pass on `main`.

After each task: append entry here, commit with Conventional Commits.

---

### Task 5 closeout — done

- Verified HANDOFF § 9.2/9.3 corrections were already applied
  (`biome.json` explicit globs, `process.env.FOO` dot access in `env.ts`).
- Ran `biome check --write --unsafe` on `apps/web packages/` — fixed all
  `useSortedClasses` warnings (shadcn-generated files).
- Added biome override for `apps/web/src/components/ui/**` to disable
  `noLabelWithoutControl` (shadcn `<Label>` wrapper is a primitive that
  doesn't know its control yet; standard a11y rule misfires here) and
  `noDefaultExport` for parity with other shadcn primitives.
- All gates green:
  - `@acr/shared`: 8/8
  - `@acr/db`: 7/7
  - `@acr/agent`: 9/9
  - `@acr/web` typecheck: clean
  - `@acr/web` build: clean (7 static routes generated)
  - `biome check`: clean
- Audited `apps/web/package.json`: name `@acr/web`, all three workspace
  packages wired, no banned deps (no next-themes, eslint, axios, date
  libs, state libs, sentry, langfuse, anthropic-sdk, ai). `.eslintrc` and
  default README already removed by Kiro.
- Boot test: dev server crashed on Turbopack with
  `TypeError: Cannot set property message of [object Object]` (Next 16.2.6
  Turbopack regression with our module graph — reproduced even with
  `instrumentation.ts` removed). Fixed by switching dev/build scripts to
  `--webpack` flag, which matches the `--no-turbopack` choice made at
  create-next-app time. All four routes serve 200: `/`, `/reviews`,
  `/repos`, `/settings`.
- Created `apps/web/.env.local` with placeholder values so the env loader
  (which fail-loud-validates at startup) doesn't crash dev boot. Already
  gitignored.
- Pre-commit hook: gitleaks was already installed via brew (`8.30.1`); no
  changes needed to `lefthook.yml`.
