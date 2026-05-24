# Prompts Change Log

> Prompts are versioned artifacts. Never edit a published version in place. Bump to the next version, log the change here, and re-run evals to capture the delta.

## How to bump a version

1. Copy `packages/agent/src/prompts/versions/system-vX.Y.ts` to `system-vX.(Y+1).ts`
2. Make your changes in the new file
3. Update the re-export in `packages/agent/src/prompts/index.ts`
4. Add an entry below
5. Run evals on a branch named `eval/prompt-vX.Y+1`
6. Open a PR; CI posts eval delta automatically
7. Merge only if delta is acceptable (judge score not down >3%, cost not up >20%)

## Version format

`system-v<major>.<minor>.ts`

- **Major**: significant architectural change (new sections, new structured output schema, new tool conventions)
- **Minor**: refinements, examples added, wording tweaks

## Change log

### v0.1 — initial placeholder (Phase 1)

- **Date**: 2026-05-13
- **Author**: project author
- **Change**: One-liner ("(Real prompt arrives in Phase 3.)") so the
  file existed for the loop stub to import. Not used in any review.
- **Eval impact**: N/A (no eval dataset yet)

### v0.2 — tool-using reviewer (Phase 3.1)

- **Date**: 2026-05-15
- **Author**: project author
- **Change**: First real system prompt. Sets up the senior-engineer
  reviewer persona, documents the four tools the agent will have
  available (`search_code`, `read_file`, `find_references`,
  `run_tests`), specifies the `submit_review` tool as the final step,
  and adds a prompt-injection guard against instructions embedded in
  diff or retrieved content.
- **Eval impact**: not yet measured. Phase 3.1 ships the prompt but
  the loop that uses it lands in 3.4; eval baseline is Phase 4.
- **Verdict**: provisional. Expected to bump to v0.3 once retrieval +
  loop are wired end-to-end and the first eval run surfaces gaps.

## Prompt anatomy

The system prompt is composed of these sections, in order:

1. **Role** — "You are a senior code reviewer..."
2. **Objective** — what success looks like for one review
3. **Tools description** — list of tools and when to use each (Phase 3+)
4. **Output schema** — exact structured JSON the agent must produce
5. **Style guidance** — terse, code-grounded, no fluff
6. **False-positive heuristics** — what NOT to flag
7. **Few-shot examples** — 2–4 high-quality demos

When a section grows past ~10 lines, consider breaking it out into a separate prompt fragment file under `packages/agent/src/prompts/fragments/`.

## Hard rules for prompt content

- ✅ Concrete examples beat abstract rules
- ✅ Negative examples ("don't flag X") are as valuable as positives
- ✅ Output schema must be a Zod-compatible JSON Schema
- ❌ No "be helpful and accurate" filler
- ❌ No claims the model can't verify (no fake user names, no fake timestamps)
- ❌ No instructions that contradict tool definitions
