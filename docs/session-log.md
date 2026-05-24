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

### Task 9 — apps/indexer Python scaffold — done

- `apps/indexer/pyproject.toml` declares Python ≥3.12, deps
  `pydantic` + `pydantic-settings`, dev deps `ruff` + `pytest`,
  hatchling build backend, Ruff config (line-length 100,
  target py312, ruleset E/F/I/B/UP/N/S, S101 disabled in tests).
- Three packages under `src/`:
  - `indexer/`: stub `cli.py` printing "not implemented (Phase 2)"
  - `evals/`: stub `cli.py` printing "not implemented (Phase 4)"
  - `shared/`: `config.py` exposing a frozen Pydantic `Settings`
    model that reads DB URL + LLM keys from `.env`.
- `tests/test_config.py` covers default loading and the
  frozen-model guarantee.
- Gates green: `uv sync` resolves cleanly,
  `uv run ruff check .` passes, `uv run ruff format --check .`
  passes, `uv run pytest` reports 2/2.
- Pre-commit hook: lefthook ruff command moved to `root:
  apps/indexer` so staged-file paths resolve correctly when ruff
  runs there. Previously it E902'd because absolute paths were
  being interpreted relative to the indexer subdir.

### Task 10 — CI green — done

- All local quality gates green on a clean run:
  - `pnpm install --frozen-lockfile` — clean
  - `pnpm lint` (biome check .) — 74 files, no issues
  - `pnpm typecheck` (turbo across 4 packages) — clean
  - `pnpm test` (turbo across 4 packages) — 29/29:
    shared 8 + db 7 + agent 9 + web 5
  - `pnpm --filter @acr/web build` — 8 routes
  - `uv run ruff check .`, `uv run ruff format --check .`,
    `uv run pytest` (apps/indexer) — clean, 2/2
  - `gitleaks detect` — no leaks across full history
- Added a `build-web` job to `.github/workflows/ci.yml` so the
  Next.js build is exercised on every push/PR. Sets
  `SKIP_ENV_VALIDATION=1` because Vercel provides the real env
  at deploy time — CI just needs to prove the bundle compiles.

## Phase 1 — complete

Ship criteria met (per `docs/roadmap.md` Phase 1):
- ✅ Web app builds and renders four routes locally.
- ✅ `/api/reviews` accepts a diff, validates with Zod, streams
  a structured placeholder review back, and persists the row.
- ✅ Reviews list + detail pages read directly from Postgres.
- ✅ Sentry + Langfuse wired (env-gated, no traces yet).
- ✅ Local CI checks green; GitHub Actions workflow updated.

Deferred to Phase 2 prep (per the TODO + HANDOFF):
- 🔧 Convert monorepo to TypeScript project references so
  cross-package source can be imported without the
  webpack `extensionAlias` workaround.
- 🔧 Replace the env-validation passthrough with a properly
  hoisted dotenv load via `@next/env` (currently blocked by
  client-bundle 'fs' import) or split env into client + server
  files.

Packages created in Phase 1:
- `packages/shared` — Zod env loader, shared types (`Result`,
  `ReviewStatus`, `FindingSeverity`).
- `packages/db` — Drizzle schema for `reviews`, migration with
  pgvector pre-step, postgres-js client, re-exported drizzle
  query helpers to avoid pnpm peer-dep splitting.
- `packages/agent` — frozen public interface (`ReviewInput`,
  `Finding`, `ReviewOutput`, `ReviewChunk`); `runReview` stub
  throws `Not implemented` until Phase 3.
- `apps/web` — Next.js 15 + Tailwind 4 + shadcn/ui;
  `/api/reviews` streaming route with Langfuse-wrapped span;
  paste-diff UI + list + detail; Sentry + global-error wired.
- `apps/indexer` — Python 3.12 skeleton with `indexer/`,
  `evals/`, `shared/` packages; stub CLIs; frozen Pydantic
  Settings model.

Proposed Phase 2 task breakdown (`RAG done right`):
1. ~~**ADR-002 + project-references migration**~~ — **done**
   immediately after Phase 1 close (see entry below).
2. **Schema for `repos`, `documents`, `chunks`** — Drizzle
   tables + migration including pgvector HNSW index on the
   `chunks.embedding` column.
3. **Python chunking pipeline** in `apps/indexer/indexer/` —
   tree-sitter per-language grammars, AST-aware chunk
   selection, Pydantic models for the chunk row.
4. **Voyage embeddings adapter** — batched `voyage-code-3`
   calls, retry/backoff, write through to `chunks.embedding`.
5. **Contextual retrieval prefix generator** — short Claude
   call per chunk to add the "what is this chunk?" prefix
   (Anthropic's pattern); cache by content hash.
6. **Hybrid retrieval in `packages/agent/src/retrieval/`** —
   BM25 (Postgres FTS) + vector + reciprocal rank fusion.
7. **Cohere `rerank-3` integration** — final reranker over
   the top 30 hits, take top 10.
8. **Replace placeholder in `/api/reviews`** with a real
   retrieval pass — still no agent loop yet, just retrieve
   context and stitch it into a single Claude call.
9. **Retrieval recall fixture + smoke benchmark** — tiny
   golden set so Phase 4 has something to anchor on.



## Phase 2 prep — TypeScript project references — done

Picked up the deferred TODO from HANDOFF § 9.5 / repo-root `TODO`
immediately after Phase 1 closed.

- ADR-002 written at `docs/adr/002-typescript-project-references.md`
  covering context (rootDir conflict + webpack `.js` workaround +
  Phase 3 expansion risk), the decision, consequences, and four
  rejected alternatives.
- All three packages (`@acr/shared`, `@acr/db`, `@acr/agent`) now
  carry `composite: true`, real `tsc --build` emit to `dist/`
  (`.js` + `.d.ts` + sourcemaps + declaration maps), and
  package.json `exports` pointing to the compiled artifacts. Test
  files are excluded from emit.
- Project graph wired via `references` arrays: `@acr/db` →
  `@acr/shared`; `apps/web` → all three. A new root `tsconfig.json`
  enumerates the packages so `pnpm build:packages` walks the graph
  with one `tsc --build`.
- `tsconfig.base.json` dropped `noEmit: true` so packages can
  actually emit. `apps/web` keeps `noEmit: true` in its own
  tsconfig because Next handles emission.
- `apps/web/next.config.ts` dropped the `webpack.extensionAlias`
  workaround and `transpilePackages` — Next now resolves through
  the packages' compiled dist like any normal npm package.
- `packages/db/src/client.ts` migrated to import `serverEnv` from
  `@acr/shared/env`, deleting the duplicate `process.env` read
  that was the original symptom of the rootDir conflict.
- CI workflow gained a `Build packages` step in each TS job so the
  compiled artifacts exist before lint/typecheck/test/web-build
  run.
- All gates green on a clean build: `pnpm install --frozen-lockfile`,
  `pnpm build:packages` (3 packages emit), `pnpm lint` (75 files,
  no issues), `pnpm typecheck` (7 tasks via turbo), `pnpm test`
  (29/29 across 4 packages), `pnpm --filter @acr/web build` (8
  routes, no warnings), dev server boots and serves `/`,
  `/reviews`, `/reviews/new` at 200 with no `transpilePackages`
  declared.

## Phase 4 takeover — 2026-05-24

Picking up evals after Phases 2 + 3 shipped (commits 5f72f6a … ca2b80c).
Phase 2 + 3 are intentionally not logged here in detail — the commits
are authoritative and re-summarizing burns context that's better spent
on Phase 4 itself.

**Stack reminders relevant to Phase 4:**

- Eval CLI is Python (`apps/indexer/src/evals/`) using uv + Pydantic v2.
- Agent loop is TS (`packages/agent/src/`) and **protected**. The Python
  runner must invoke it through its public `runReview` surface via a TS
  bridge (task 4.6).
- LLM-as-judge calls Anthropic Sonnet with prompt caching on the rubric;
  judge is the only real-token-spending component during eval execution.
- Stack-wide observability is Langfuse (per ADR-001), not Braintrust —
  the existing `.github/workflows/eval.yml` mentions Braintrust and will
  be reworked in 4.8.

**Phase 4 plan (refined from the handoff):** 4.1 schema + 5 seed
examples → 4.2 deterministic scorers → 4.3 LLM-as-judge → 4.4 summary
+ delta writer → 4.5 runner orchestrator → 4.6 TS bridge → 4.7 wire
CLI → 4.8 rewrite eval.yml (drop Braintrust) → 4.9 first real run
(cutover, ~$1–3) → 4.10 expand dataset to 30+ examples.

### Task 4.1 — dataset schema + 5 seed examples — done

- `apps/indexer/src/evals/schema.py` — Pydantic v2 models for the
  golden-dataset schema documented in `docs/evals.md`:
  - `GroundTruthFinding` (category/severity literals, summary, optional
    location_hint + source_comment_url).
  - `GroundTruth` (findings, expected_findings_count, false_positive_traps)
    with an `@model_validator` enforcing `expected_findings_count ==
    len(findings)`.
  - `EvalExample` (id pattern `^[a-z0-9][a-z0-9-]*$`, optional
    `HttpUrl`, title/diff, ground truth, difficulty enum, curation
    metadata). All models `frozen=True` + `extra="forbid"`.
  - `load_examples_jsonl(path)` returns the validated list; raises
    `DuplicateExampleIdError` if two rows share an `id`; skips blank
    and `#`-comment lines so JSONL files can self-document.
- `evals/datasets/v1/examples.jsonl` — five hand-crafted **seed**
  examples generated via a throwaway `temp/build_seed_dataset.py`
  (gitignored). Coverage spans every field and the difficulty mix:
  - `seed-py-null-deref` (easy, bug/major) — None-check removed.
  - `seed-ts-off-by-one` (easy, bug/minor) — `<` → `<=` array overshoot.
  - `seed-react-stale-closure` (medium, bug/major) — empty deps +
    non-functional updater. Includes a false-positive trap.
  - `seed-sql-injection` (medium, security/critical) — f-string SQL
    interpolation of user input. Includes a false-positive trap.
  - `seed-race-condition` (hard, bug/critical) — Mutex removed,
    concurrent Go map writes. Includes a false-positive trap.
  - `pr_url` is `null` for all seeds; real-PR examples land in 4.10.
- `evals/datasets/v1/README.md` documents the seed-vs-real split, the
  immutability contract, and the v1 difficulty-mix target.
- `apps/indexer/tests/test_evals_schema.py` — 13 new tests covering
  schema-level validation, the `expected_findings_count` invariant,
  duplicate-id detection, comment-line skipping, and a guard
  (`test_dataset_v1_loads`) that fails the build if the checked-in
  JSONL stops parsing.
- Gates: `uv run ruff check .` clean, `uv run ruff format --check .`
  clean, `uv run pytest` 53/53 (was 40 before this task). TS gates
  untouched: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test`
  165/165.

### Task 4.2 — deterministic scorers — done

- `apps/indexer/src/evals/scorers/` subpackage of pure-function
  scorers, no I/O. Public surface re-exported from
  `evals.scorers.__init__`:
  - `types.py` — `PredictedFinding` / `PredictedReview` Pydantic v2
    models that mirror `Finding` / `ReviewOutput` in
    `packages/agent/src/types.ts`. `populate_by_name=True` + a
    `locationHint` alias lets the wire format come in camelCase
    while Python attributes stay snake_case. Frozen + `extra="forbid"`.
  - `tokens.py` — token-overlap helpers: `tokenize` (lowercase, regex
    split, short stoplist, cheap plural collapse via trailing-`s`),
    `jaccard`, `summary_match(predicted, truth, threshold=0.2)`,
    `summary_similarity` for diagnostics. Default threshold tuned
    against the seed-dataset summaries: a paraphrased agent output
    on `seed-py-null-deref` clears it (Jaccard ≈ 0.5) while
    obviously-wrong outputs don't.
  - `category.py` — exact-match scorer (0 / 1). Categories are too
    distinct to grade on a gradient.
  - `severity.py` — distance-based scorer: exact → 1.0, off-by-one
    → 0.5, off-by-two → 0.0, using `{minor: 0, major: 1, critical: 2}`.
  - `location.py` — `parse_location` understands `file:line`,
    `file:start-end`, and bare `file`; `location_score` grades by
    file-match + line-distance bucket (≤5 → 1.0, ≤20 → 0.5, > 20
    → 0.3, one side missing line → 0.7). Returns 0.0 when files
    differ or either side is unparseable.
  - `findings.py` — `match_findings(predictions, ground_truth)`
    does a greedy 1-to-1 pairing of predictions to truth findings
    using `summary_similarity`, then classifies the leftovers as
    `false_positives` or `false_positive_traps_triggered` via
    semantic match against `ground_truth.false_positive_traps`.
    Returns a frozen `MatchResult` dataclass with `matches`,
    `found_ground_truth_bug`, `false_positives`,
    `false_positive_traps_triggered`, and `unmatched_truth_indices`
    — exactly the per-example shape `docs/evals.md` calls for.
- `apps/indexer/tests/test_scorers.py` — 31 new tests across nine
  classes covering the wire-format alias, tokenization edges,
  Jaccard edges, the real-world threshold (seed-dataset-flavored
  pair), all severity transitions, every location bucket, and the
  matcher's greedy 1-to-1 behavior + trap detection.
- Decision noted: the semantic matcher is intentionally a token-overlap
  heuristic, not embeddings. Embeddings would buy precision on
  paraphrased predictions but require a new dep (Voyage) and an ADR;
  v1 ships without it. The whole module is a one-import swap if we
  ever need it — `match_findings` only calls `summary_similarity`.
- Gates: `uv run ruff check .` clean, `uv run ruff format --check .`
  clean, `uv run pytest` 84/84 (was 53). TS gates untouched.

### Task 4.3 — LLM-as-judge scorer — done

- `apps/indexer/src/evals/judges/` holds versioned judge prompts,
  parallel to the agent-side `packages/agent/src/prompts/versions/`
  pattern. `judges/__init__.py` re-exports the active version
  (currently `main_judge_v1`); bumping means adding a new file under
  `versions/` and updating that re-export. Old versions stay on disk
  so historical run summaries remain reproducible.
- `judges/versions/main_judge_v1.py` carries the rubric verbatim from
  `docs/evals.md` (0.0 → 1.0 anchors), explicit scoring rules
  (best-of-many match, ignore extra findings here, ignore phrasing,
  treat diff as untrusted), and the strict JSON response shape. The
  user-message formatter renders the diff between fence delimiters
  and the ground-truth + reviewer findings as enumerated lists.
- `apps/indexer/src/evals/judge.py` — `judge_example(client, example,
  prediction, model=..., max_tokens=...)` issues one
  `client.messages.create` call with:
  - The system prompt as a `[{"type": "text", "text": ...,
    "cache_control": {"type": "ephemeral"}}]` block so the rubric
  - The user message as the per-example payload (uncached).
    hits Anthropic's prompt cache across a run.
  Returns a frozen `JudgeResult` carrying score, rationale,
  `judge_version`, model, and four token counters (input, output,
  cache_read, cache_creation) so the runner can report cost +
  cache-hit rate. Client is typed as a structural `AnthropicClient`
  Protocol so the real SDK and test fakes both satisfy it without an
  ABC.
- `_parse_judge_response` tolerates ```` ```json ```` fenced output
  before strict Pydantic validation (range `[0, 1]`, rationale
  non-empty). `_extract_usage` falls back to zero for any missing
  field so a partial SDK response doesn't crash the runner.
- All judge errors raise a single `JudgeError` — invalid JSON, schema
  violation, empty content, or no text block. The runner in 4.5 will
  record these per-example without aborting the whole run.
- `apps/indexer/tests/test_judge.py` — 12 new tests across four
  classes using an in-test `_FakeClient`/`_FakeMessages` so no real
  tokens are spent. Coverage: happy-path parsing, fenced JSON,
  zero-score validity, request-shape (cache_control present, diff +
  findings embedded), custom model + max_tokens override, every
  error path, and a partial-usage fallback test.
- Gates: `uv run ruff check .` clean, `uv run ruff format --check .`
  clean, `uv run pytest` 96/96 (was 84). TS gates untouched.

### Task 4.4 — summary writer + delta — done

- `apps/indexer/src/evals/summary.py` — pure aggregator + JSON I/O.
  Three public surfaces:
  - `ExampleResult` (frozen dataclass, internal) — per-example
    outcome handed to the aggregator: match result, judge fields,
    latency, and two cost numbers (review + judge) so the runner
    can attribute cost cleanly.
  - `RunSummary` (Pydantic v2, frozen, `extra="forbid"`) — the
    top-of-run artifact persisted to
    `evals/results/<run-id>/summary.json`. Carries every aggregate
    in `docs/evals.md` (judge_score, deterministic_score,
    false_positive_rate, trap_rate, p50/p95 latency, mean +
    total cost), failed-judge count, per-difficulty breakdowns,
    optional `delta` map vs a prior run, and a `verdict` literal.
  - `DifficultyBreakdown` — per-difficulty slice. `judge_score`
    can be `None` when every judge call in that slice errored.
- `build_summary(...)` is pure. Handles empty `results` (zero
  everywhere, verdict "below-bar"). Skips errored judges when
  computing the mean but still counts them in `failed_judge_count`.
  Cost-per-review aggregates both review and judge spend so the
  pass-bar check sees true per-example cost.
- Verdict logic encodes the Phase-4-ship bars from `docs/evals.md`:
  `judge_score ≥ 0.55 ∧ deterministic_score ≥ 0.40 ∧
  false_positive_rate ≤ 1.5 ∧ mean_cost_per_review_usd ≤ 0.05`.
  Bars live in a `PASS_BARS` dict at module top so they're easy
  to find when a phase ship moves them.
- `percentile(values, pct)` — linear-interpolation percentile that
  returns 0 on empty input and rejects `pct` outside `[0, 1]`.
- `_delta_against(current, prior)` — per-metric delta map keyed by
  the same field names as `RunSummary`. Built only when a prior is
  passed in; `build_summary` re-creates the summary via
  `model_copy(update={"delta": ...})` so the type stays frozen.
- I/O helpers: `dump_summary` (pretty JSON, mkdir parents),
  `load_summary` (Pydantic strict validation), and
  `find_latest_summary(results_root)` — walks `results_root/*/summary.json`,
  skips half-written / non-parsing directories, returns the most
  recent by `created_at`. The runner uses this to find the prior
  main-branch run for the delta block.
- `apps/indexer/tests/test_summary.py` — 19 new tests across five
  classes: percentile edges, empty / passing / below-bar build
  paths, FP/trap aggregation, errored-judge handling, per-difficulty
  breakdown (including empty-slice with `None` judge), delta
  positive/negative, round-trip serde, `find_latest_summary`
  picking the most recent, and skipping malformed prior files.
- Gates: `uv run ruff check .` clean, `uv run ruff format --check .`
  clean, `uv run pytest` 115/115 (was 96). TS gates untouched.

### Task 4.5 — runner orchestrator + pricing — done

- `apps/indexer/src/evals/pricing.py` — static Anthropic price table
  (USD per million tokens) for Haiku 4.5, Sonnet 4.5 / 4.6, Opus 4.7.
  `anthropic_cost_usd(model, input/output/cache_read/cache_creation)`
  returns 0.0 for unknown model names so a typo'd run reports zero
  instead of crashing. Snapshot, not live — update when Anthropic
  changes prices.
- `apps/indexer/src/evals/runner.py` — orchestrator. Public surfaces:
  - `BridgeResult` (frozen dataclass) — what the agent bridge returns
    per example: `PredictedReview`, `latency_ms`, `cost_usd`.
  - `AgentBridge` (Protocol) — callable `(EvalExample) -> BridgeResult`.
    The 4.6 TS bridge will be a subprocess-wrapping concrete class
    implementing this; tests pass an in-process stub.
  - `ExampleTrace` (Pydantic) — the per-example record persisted to
    `evals/results/<run-id>/raw/<id>.json`. Bundles
    `_BridgeTrace`, `_JudgeTrace | None`, `_MatchTrace`, and the
    captured `judge_error` string when the judge blew up. All frozen,
    `extra="forbid"`.
  - `run_eval(examples, bridge, judge_client, judge_model=...,
    output_dir=None, on_example_start=None, on_example_done=None)`
    walks examples in order, calls `bridge`, runs `match_findings`,
    invokes `judge_example` (catches `JudgeError`, records it in the
    trace, does NOT abort the run), computes judge cost from token
    counters via `anthropic_cost_usd`, and emits an `ExampleResult`
    ready for `build_summary`. Per-example trace files are written
    only when `output_dir` is given.
- The callback hooks (`on_example_start` / `on_example_done`) exist
  so the CLI in 4.7 can stream progress without the runner knowing
  anything about TTYs or logging.
- `MatchResult` is a frozen dataclass with tuples, so the runner
  hand-converts it to a Pydantic `_MatchTrace` (lists of matched +
  unmatched truth indices) for serialization.
- `apps/indexer/tests/test_pricing.py` — 5 tests covering the
  pricing table edges (base case, cache_read discount, cache_write
  premium, unknown model fallback, known-models surface).
- `apps/indexer/tests/test_runner.py` — 8 tests with the same
  in-test `_FakeClient` shape as the judge tests + a `_StubBridge`.
  Coverage: happy path with cost-attribution math, judge failure
  captured per-example without aborting, trace serialization (incl.
  the judge-error case), output_dir omitted → no disk writes,
  callbacks fire in order, example order preserved, custom judge
  model honored.
- Gates: `uv run ruff check .` clean, `uv run ruff format --check .`
  clean, `uv run pytest` 128/128 (was 115). TS gates untouched.


