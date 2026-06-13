# Shared Rules

This is the baseline context for all AI agents operating in the AI Code Reviewer repository.

## Universal Constraints
- Review the `standards/never-do.md` file before proposing any architectural changes or dependency updates.
- Review the `standards/coding-conventions.md` file for stack-specific rules (TypeScript/Python).
- Treat `packages/agent/src/loop.ts`, `packages/agent/src/prompts/`, and `packages/agent/src/retrieval/` as PROTECTED. Do not modify them unless explicitly directed by the user.

## Loading Additional Context
You must dynamically load additional rules based on your current task:
- If modifying core system boundaries, components, or DB schemas, load `steering/architecture-rules.md`.
- If modifying the LLM evaluation, AI review loop, or prompting logic, load `steering/review-rules.md`.

## Engram — project index of intent (`.engram/INDEX.md`)

⛔ **READ FIRST.** The compiler / LSP / grep own **structure** (what calls what). Engram owns
**intent** — the non-derivable *why* and *why-not* that no tool can recover from the code.

- **Before editing ANY file, you MUST first read `.engram/INDEX.md`** and check whether that area
  has an entry — *especially* for `packages/agent/{loop.ts,prompts,retrieval}`, anything under
  `packages/db/` or the DB schema, the `packages/agent/src/prompts/versions/` files, and the event
  stream (`loop.ts` ↔ `use-review-stream.ts` / the stream reducer). If an entry exists, **state what
  you found before you edit**, and respect its `Why` / `Not`. The `Not:` field records changes already
  considered and **rejected** — if your edit matches a `Not:`, **STOP and confirm with the user; do
  not "fix" it.** A request that sounds like an obvious cleanup is *exactly* when to check first.
- **After a real decision**, propose a new or edited entry (`What / Where / Why / Not / Decided`) —
  batched at the task boundary, written on a one-word confirm. New concept → new entry; changed
  decision → **edit** the entry and move the old call into `Not:`.
- **NEVER fabricate a `Why` or `Not`.** Write only the reason the user actually gave you or that the
  code plainly shows. If you don't have the real reason, write `⚠️ CONFIRM` — do not invent a
  plausible-sounding history. When a request contradicts an existing entry, **stop and ask**.
- An entry earns its place only if it is non-derivable, load-bearing, and durable (the Three-Gate
  test). Coverage is a non-goal. Fix or delete any stale entry you pass through.
