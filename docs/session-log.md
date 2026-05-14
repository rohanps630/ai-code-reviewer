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

### Task 6 — env loader + Sentry + Langfuse wiring — done

- Added `@sentry/nextjs` (10.53.1) and `langfuse` (3.38.20) to
  `apps/web/package.json`. Both env-driven; no calls traced yet.
- Sentry runtime config split per Next 15+ convention:
  - `sentry.server.config.ts` and `sentry.edge.config.ts` (loaded by
    `instrumentation.ts` based on `NEXT_RUNTIME`)
  - `instrumentation-client.ts` for browser init (Sentry 10 pattern,
    replaces the old `sentry.client.config.ts`)
  - Each init is gated on the relevant DSN env being present so missing
    secrets don't crash boot during dev.
- `instrumentation.ts` now also re-exports `Sentry.captureRequestError`
  and `instrumentation-client.ts` exports `onRouterTransitionStart` so
  Sentry can hook Next's request and router signals.
- `apps/web/src/app/global-error.tsx` added so unhandled rendering
  errors are reported (was previously a Sentry warning at boot).
- `next.config.ts` wraps the export in `withSentryConfig` with
  `tunnelRoute: "/monitoring"` so client beacons dodge ad blockers.
  Migrated deprecated `disableLogger` / `reactComponentAnnotation`
  options to the new `webpack.*` nested form.
- `apps/web/src/lib/langfuse.ts` exports a lazy `getLangfuse()`
  singleton — returns a client when keys are set, `null` otherwise.
  Phase 1 doesn't actually trace yet (Task 7 will).
- All env vars (Sentry, Langfuse) were already in the
  `packages/shared/src/env.ts` Zod schema. No additions needed.
- Added `global-error.tsx` and `instrumentation-client.ts` to
  biome.json's `noDefaultExport` exception list.
- Gates: typecheck clean, build clean, biome clean, dev server boots
  and serves `/` at 200.

### Task 7 — /api/reviews streaming route — done

- Added `ai`, `@anthropic-ai/sdk`, `zod`, `drizzle-orm` (direct), and
  `vitest` (dev) to `apps/web`. Anthropic SDK installed for Task 7's
  brief but not used yet — placeholder generator carries the stream.
- New route handler at `apps/web/src/app/api/reviews/route.ts`:
  - Zod-validates POST body (`diff` non-empty, optional `model`
    enum, defaults to `sonnet`).
  - 400 with flattened Zod errors on bad input.
  - Inserts a `reviews` row with status `pending`, transitions
    `streaming` then `completed`, with `output` set to the final
    `ReviewOutput` and zeroed token/cost for the placeholder.
  - Streams NDJSON of `ReviewChunk` objects so the UI can render
    progressively without depending on the AI SDK's wire protocol
    (which churned between v5 and v6).
  - Calls `runReview` from `@acr/agent`, catches its "Not
    implemented" throw, falls back to `placeholderReview()` —
    proves the wiring works end-to-end while the agent loop is
    still gated.
  - Wraps the whole streamed run in a Langfuse `trace` + `span`,
    flushing on stream end (success or failure). No LLM calls yet.
- `placeholderReview()` (`apps/web/src/app/api/reviews/placeholder.ts`)
  emits a realistic ReviewChunk sequence: two status updates, ~20
  tokenized text deltas, and a synthetic `final` with two findings
  spanning severities and categories.
- 5/5 vitest tests pass: invalid body → 400, empty `diff` → 400,
  full stream + DB transitions verified, Langfuse trace + flush
  verified, model default verified. Tests mock `@acr/db`,
  `@acr/db/client`, and `@/lib/langfuse` at the module level.
- Cross-package import fixes:
  - Re-exported `eq, and, or, desc, asc, sql` from `@acr/db` so
    consumers use the same `drizzle-orm` instance @acr/db's table
    schemas were built against (pnpm peer-dep splitting can hoist
    two copies otherwise, and the Column types don't unify).
  - `next.config.ts` adds a webpack `extensionAlias` mapping
    `.js → .ts/.tsx/.js` so the TS source's NodeNext `.js`
    specifiers (correct ESM, can't be removed without touching
    protected `@acr/agent/src/` paths) resolve to the actual TS
    files. Also added `transpilePackages` for the three workspace
    packages.
- Env validation: relaxed `@acr/shared/env` to skip in
  non-production / build-phase contexts. Reason: Next 16's
  page-data and route-handler workers don't reliably inherit
  `.env*` from the parent process, so the previous fail-loud parse
  crashed both `next build` and route handlers in dev. Production
  (`NODE_ENV=production`) still parses and fails loud. Force the
  strict behavior anywhere with `SKIP_ENV_VALIDATION=0` semantics
  if needed.
- Manual smoke: dev `POST /api/reviews` with `{}` → 400 (good);
  with valid body → 500 because the placeholder DATABASE_URL has
  no local Postgres listening, which is expected for Phase 1 dev
  without Supabase configured. Unit tests cover the 200 path with
  a mocked db.
- Gates: shared 8/8, db 7/7, agent 9/9, web 5/5, web typecheck
  clean, web build clean, biome clean.

### Task 8 — minimal UI — done

- `/reviews/new` (client) — paste-diff card, model select
  (Haiku/Sonnet/Opus), submit. Custom `useReviewStream` hook in
  `components/features/reviews/use-review-stream.ts` reads NDJSON
  from `/api/reviews` via fetch + `getReader`, accumulates a
  status ticker, text deltas (rendered through `react-markdown`),
  and the final structured `ReviewOutput`. Submit button disabled
  while streaming. Wrapped in `<Suspense>` so `useSearchParams` is
  build-safe (Re-run on the detail page passes `?diff=&model=` so
  the page can prefill).
- `/reviews` (server) — lists last 50 reviews via Drizzle ordered
  by `created_at desc`. Empty state when no rows; gracefully
  renders an error message when the DB is unreachable (so Phase 1
  dev without Supabase still renders rather than 500-ing).
- `/reviews/[id]` (server) — full diff, structured output,
  metadata, and a Re-run form that navigates to `/reviews/new`
  with the prior diff + model preloaded.
- New domain components under
  `apps/web/src/components/features/reviews/`:
  `ReviewCard` (list row with status badge),
  `DiffViewer` (line-colored `<pre><code>`),
  `FindingItem` (severity/category badges).
- App nav gained a "New" link. The list-page CTA links into
  `/reviews/new` via `buttonVariants()` (the shadcn `<Button>`
  here is from `@base-ui/react` and doesn't support `asChild`).
- Deps: added `react-markdown`. No auth, no user-scoping (Phase 1
  is open access as the brief calls out).
- Gates: shared 8/8, db 7/7, agent 9/9, web 5/5, typecheck clean,
  build clean, biome clean. Dev smoke: `/`, `/reviews`,
  `/reviews/new` all 200; `POST /api/reviews` returns 400 with
  Zod errors on invalid body. Full stream requires a real DB
  (Supabase), which Phase 1 deploy will provide.

