# Project index — intent & why-not

> **This is an Engram index.** It records the **non-derivable why** of this codebase — why parts are
> the way they are, and what was rejected and why. It is **not** documentation and **not** a symbol
> index (the LSP/ctags/grep own structure). Keep it **curated, not complete**.
>
> **Agent:** read the relevant entry **before editing** an area; **after a real decision**, propose a
> new/edited entry (batched at the task boundary, written on confirm). An entry earns its place only if
> it is **non-derivable · load-bearing · durable** (the Three-Gate test). When a decision changes,
> *edit* the entry and move the old call into `Not:`. Fix or delete any stale entry you pass through.
>
> Lines marked **⚠️ CONFIRM** are inferred, not confirmed by the author — verify the real reason
> before relying on them, and replace the marker with the confirmed rationale (or delete the entry).

---

<!--
ENTRY FORMAT — copy this block for each concept worth finding:

## <Area> — <concept>
_aka: <synonyms, only if the heading wouldn't match how you'd search>_

- What:  one line — what this part does
- Where: a HINT — the file(s)/area, not an exhaustive symbol list (reconfirm against live code)
- Why:   the non-derivable rationale — why this shape was chosen
- Not:   what was rejected and why (the highest-value field); on reversal, the old decision moves here
- Decided: YYYY-MM-DD
-->

## Event stream — one reducer drives both the live run and DB replay
_aka: agent_events, ReviewChunk, NDJSON, replay invariant, use-review-stream_

- What:  the agent run emits NDJSON `ReviewChunk`s; each chunk is teed into the `agent_events`
  Postgres table in strict per-`review_id` `seq` order. The review-detail UI reconstructs a finished
  run from that table using the **exact same reducer** (`review-stream-state.ts`) that the live stream
  uses.
- Where: `packages/agent/src/loop.ts` (`runReview`), `apps/web/src/components/features/reviews/use-review-stream.ts`, the stream reducer, `apps/web/src/app/api/reviews/[id]/stream/`, `contracts/event-stream.md`
- Why:   the transport (plain NDJSON over HTTP, hand-rolled) was **built by hand deliberately, as a
  learning exercise** — understanding streaming from first principles was the point, not avoiding a
  dependency. It happens to keep the replay path simple: a review replayed from the DB yields an
  **identical state tree / UI** to the live run (the replay invariant — useful for audit +
  debuggability), guaranteed by sharing one reducer between live and replay; a second, replay-only
  reducer would silently drift.
- Not:   the **Vercel AI SDK** / raw WebSockets were **not rejected on the merits** — they were simply
  not used because hand-building was the learning goal. ✅ The AI SDK is fair game to adopt if it
  actually helps; this is *not* a constraint against it. (The replay-invariant property is the part
  worth preserving across any transport swap.)
- Decided: 2026-06 (contract: `contracts/event-stream.md`)

## Database — Drizzle (TS) owns the schema; the Python indexer mirrors it read-only
_aka: shared Postgres, packages/db, apps/indexer, pgvector, chunks, documents, semantic_cache_

- What:  a single Postgres DB is shared by `apps/web` (Next.js) and `apps/indexer` (Python).
  `packages/db` (Drizzle) is the **sole** schema owner and migrator. The Python worker reads via raw
  SQL / mirrored models and **never** runs a migration. `chunks`/`documents` are written only by the
  indexer and are **read-only** from web; `semantic_cache` is ephemeral (truncatable).
- Where: `packages/db/`, `apps/indexer`, `contracts/database.md`
- Why:   one source of truth for schema across a polyglot boundary; stops two languages from racing to
  migrate the same tables, and keeps the AST-chunk/embedding pipeline's tables off-limits to the app.
- Not:   rejected letting Python migrate, and rejected treating `chunks`/`documents` as writable from
  web. Column drops / type changes on active tables are breaking across both codebases and need
  coordinated changes on the TS *and* Python sides.
- Decided: 2026-06 (contract: `contracts/database.md`)

## Prompts — immutable, versioned, eval-gated artifacts
_aka: system prompt, prompts/versions, prompt bump, eval gate, docs/prompts.md_

- What:  system prompts live as immutable files in `packages/agent/src/prompts/versions/system-vX.Y.ts`;
  one index re-exports "the current version." A change **bumps a new version** and is gated on an eval
  delta (must not regress the LLM-judge baseline by >3%, must not raise cost by >20%), logged in
  `docs/prompts.md`.
- Where: `packages/agent/src/prompts/`, `docs/prompts.md`, `contracts/prompt-versioning.md`
- Why:   a prompt *is* behavior — editing one in place silently changes results and destroys the
  ability to compare eval runs across versions. The version files are the experiment record.
- Not:   NEVER edit a published version in place; never ship a version that hasn't passed the eval
  gate. A wording tweak is a *minor* bump, not an in-place edit.
- Decided: 2026-06 (contract: `contracts/prompt-versioning.md`)

## Agent core — `loop.ts` / `prompts/` / `retrieval/` are human-owned
_aka: protected files, agent brain, no drive-by edits, new tools_

- What:  `packages/agent/src/loop.ts`, `packages/agent/src/prompts/`, and
  `packages/agent/src/retrieval/` are treated as **owned by the human**. No agent/assistant edits
  there without an explicit ask. Adding a new agent **tool** likewise requires an explicit human ask.
- Where: `packages/agent/src/{loop.ts,prompts,retrieval}`, `standards/never-do.md`, `steering/shared-rules.md`, `steering/review-rules.md`
- Why:   this is the product's reasoning core; drive-by "improvements" here are high-blast-radius,
  hard to evaluate, and easy to regress without an eval pass.
- Not:   rejected allowing routine refactors / tool additions here. If a task *seems* to need a change
  in these files, **stop and surface it** rather than editing.
- Decided: 2026-06

## Architecture — why a separate Python indexer alongside the TS app
_aka: apps/indexer, polyglot split, uv, why Python_

- What:  the indexing + evaluation pipeline is Python (`apps/indexer`, managed by `uv`) while the web
  app and agent runtime are TypeScript.
- Where: `apps/indexer`, `steering/architecture-rules.md`
- Why:   **learning + incidental** — *not* a deliberate ecosystem decision. The author wanted to
  practice Python / ML-pipeline work, and the indexer simply ended up Python; it was never chosen over
  TypeScript on the merits.
- Not:   nothing was deliberately rejected — an all-TS indexer or a managed embedding/vector service
  were **not evaluated and set aside**, they remain open options. ✅ This polyglot split is *not* a
  protected constraint: consolidating toward one language is fair game if it ever helps. The one real
  cost to honor either way is the Drizzle-schema-mirror contract (`contracts/database.md`).
- Decided: 2026-06
