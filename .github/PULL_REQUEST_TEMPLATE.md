<!-- Thanks for the PR. Fill out what's relevant. Sections with N/A can be deleted. -->

## What

<!-- One-line summary of the change -->

## Why

<!-- Motivation. Link any related issues. -->

## Approach

<!-- High-level approach. Not a play-by-play of the diff. -->

## Eval impact

<!-- Required for changes to packages/agent or evals/. Paste numbers from `pnpm eval` or the CI comment. -->

| Metric | Before | After | Δ |
|---|---|---|---|
| Judge score | | | |
| Deterministic | | | |
| Cost per review | | | |
| P95 latency | | | |

## Cost impact

<!-- Approximate cost-per-review change if relevant, or "N/A" -->

## Screenshots / traces

<!-- UI changes? Add before/after screenshots. Agent behavior change? Link Langfuse traces. -->

## Checklist

- [ ] Followed conventions in `AGENTS.md`
- [ ] Added/updated tests where appropriate
- [ ] No changes to protected paths (`packages/agent/src/{loop,prompts,retrieval}/`) without explicit approval
- [ ] If prompt changed: bumped version, logged in `docs/prompts.md`
- [ ] If a new env var: added to `.env.example`
- [ ] If a major decision: ADR added in `docs/adr/`
