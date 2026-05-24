# Phase 4 — Handoff Prompt

> Paste this into a fresh chat to resume work on Phase 4 (evals).
> Mirrors the handoff pattern that worked for Phases 1–3.
> Companion file: [`session-log.md`](./session-log.md).

---

You're taking over Phase 4 of the AI Code Reviewer project. Full context lives in the repo at `/Users/rohanpsuresh/Work/Personal/ai-code-reviewer`.

## Required reading (in order, in full, before any work)

1. [`AGENTS.md`](../AGENTS.md) — source of truth for every agent. Rules + conventions + the discovery-file contract for AI tools. Read § 7 ("Never do") and § 9 ("Agent context — single source of truth") carefully.
2. [`docs/architecture.md`](./architecture.md) — full stack, layout, retrieval/agent design.
3. [`docs/roadmap.md`](./roadmap.md) — read the Phase 4 section.
4. [`docs/session-log.md`](./session-log.md) — what every prior agent shipped, in order. Skim the Phase 1–3 entries; you'll be appending Phase 4 entries here.
5. [`docs/prompts.md`](./prompts.md) — prompt versioning policy.
6. [`docs/evals.md`](./evals.md) — eval methodology + the existing "Retrieval smoke benchmark" section (Phase 2.8).
7. [`docs/adr/`](./adr/) — three ADRs to date (stack choices, TS project refs, etc.). New significant decisions need ADR-004+.
8. `TODO` file at repo root (if present) — deferred items.

## Current state

- Phases 1, 2, 3 complete and pushed to `origin/main` (HEAD ≈ `ca2b80c`).
- 165 TS tests + 40 Python tests; build, typecheck, lint all clean.
- Real ReAct agent loop lives in `packages/agent/src/loop.ts` with four tools (`search_code`, `read_file`, `find_references`, `run_tests`).
- **NOT cut over**: the route still falls back to `placeholderReview()` on any `runReview` error. Cutover is a one-line change in `apps/web/src/app/api/reviews/route.ts` `pickSource()`, gated on the user setting `ANTHROPIC_API_KEY` + `VOYAGE_API_KEY` in Vercel/Supabase.
- A retrieval smoke benchmark already exists at `scripts/retrieval-bench.mjs` with fixture `evals/retrieval-v0/fixture.json`. Phase 4 graduates this into the real eval harness.

## Protected paths (per AGENTS.md § 7) — DO NOT MODIFY without an explicit ask

- `packages/agent/src/loop.ts`
- `packages/agent/src/prompts/` (any file)
- `packages/agent/src/retrieval/` (any file)
- `packages/agent/src/tools/` (any file)

Touching any of these requires the human to say so explicitly **in this conversation**. Past authorizations from prior chats do NOT carry over.

## Phase 4 scope (per `docs/roadmap.md`)

> Build a golden dataset and a harness that scores the agent against it.
>
> Ship criteria:
>
> - Dataset v1 with 30+ real PRs from public repos
> - `evals.cli run` produces a `summary.json` with deltas vs prior run
> - CI runs evals on PRs touching `packages/agent/`
> - PR comment posts eval table automatically

The Python eval CLI stub already exists at `apps/indexer/src/evals/cli.py`.

## Working rules (copied from how Phases 2 + 3 ran cleanly)

- **Conventional Commits** format (`feat`/`fix`/`refactor`/`chore`/`docs`/`test`/`perf`/`eval`).
- **Smallest reasonable commits.** Each green: lint + typecheck + test.
- **Dark-code pattern**: build modules with injectable deps, mock at test time. NO real API calls during build. The cutover that spends real tokens is its own explicit commit.
- **No new deps** outside ADR-001 without a new ADR.
- **No** disabling typecheck/lint to ship faster. Fix root causes.
- **pnpm only** (no npm/yarn). **uv only** (no pip).
- Pre-commit hook runs biome + ruff + typecheck + gitleaks. Use `--no-verify` only if the hook itself is broken; don't bypass for convenience.
- After each task: `pnpm typecheck && pnpm test && pnpm lint`, plus Python: `cd apps/indexer && uv run ruff check . && uv run pytest`.
- Append to [`docs/session-log.md`](./session-log.md) after each task with what shipped.

## Stop conditions — only stop and ask if

- A protected path needs modification. Ask first.
- A task brief is ambiguous or contradicts `docs/architecture.md`.
- A new dep is needed that isn't in any task brief.
- A test fails and the root cause is unclear after investigation.
- A destructive operation is needed (force push, `rm -rf` outside repo).
- You spot a token-spend risk the build-time mocks don't cover.

## Proposed Phase 4 breakdown

Start with this; refine if `docs/architecture.md` suggests otherwise.

### 4.1 — Dataset schema + first 5 examples

`evals/datasets/v1/examples.jsonl` with the schema [`docs/evals.md`](./evals.md) specifies (`id`, `pr_url`, `diff`, `ground_truth_finding`, …). Hand-craft 5 examples from real public PRs to anchor the format.

### 4.2 — Deterministic scorers

`apps/indexer/src/evals/scorers/{location,severity,category}.py`. Pure functions over `(predicted finding, ground truth) → score`. Pydantic models, full unit test coverage.

### 4.3 — LLM-as-judge scorer

`apps/indexer/src/evals/judge.py`. Wraps an Anthropic call with prompt-cached rubric + the `(diff, predicted, ground truth)` tuple. Returns 0..1 plus rationale. Injectable client; tests mock.

### 4.4 — Eval runner CLI

`apps/indexer/src/evals/cli.py` upgraded from stub. Reads dataset version, runs agent on each example (via a TS bridge — see 4.5), collects scorer outputs, writes `summary.json` to `evals/results/<run-id>/`.

### 4.5 — TS bridge for the agent

Either:

- **(a)** a small Node CLI that takes a diff on stdin and runs `runReview`, returning the final `ReviewOutput` as JSON, OR
- **(b)** a Python wrapper that shells out to (a).

Lets the Python eval runner exercise the TS agent end-to-end.

### 4.6 — CI integration

`.github/workflows/eval.yml` — runs on PRs touching `packages/agent/`. Posts the eval summary as a PR comment. Compares against the most recent main branch run.

### 4.7 — Expand dataset to 30+ examples

Use the `/new-eval` Claude Code command + manual curation. Cover the difficulty levels from `docs/evals.md`.

## Start

Begin with required reading. Confirm you understand the protected paths + the dark-code pattern, then propose your Phase 4 task breakdown (refine the one above if needed). Wait for the human's "go" before writing code. After each task: commit + push + append to session-log.

## Cost expectations

- **Build time**: $0 — every module mocks its dep at test time.
- **First eval run**: ~$1–3 (50 examples × ~$0.04/review with prompt caching on the judge prompt). Subsequent runs land in the same range as the dataset stabilizes.
- **CI runs on every PR**: scope of `packages/agent/` changes only, so most PRs skip it entirely. Budget ~$10/month sustained.

## Two practical reminders before you start

1. **Make sure your new agent inherits the auth context** — if it can't reach Anthropic/Voyage/etc., flag that upfront so we don't waste a turn debugging it.
2. **Have your env keys handy.** Phase 4 *runs* the agent during eval execution (unlike Phases 2–3, which only built it). First real spend happens here. The eval runner itself is the "cutover" — there's no separate dark-then-fire step like before.
