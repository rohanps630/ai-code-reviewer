---
description: Bump the agent system prompt to a new version
argument-hint: <minor|major> [summary of change]
---

# Bump prompt version

⚠️ This command modifies files inside `packages/agent/src/prompts/`. By default that path is protected. The human is explicitly invoking this workflow, so you may proceed — but only with the steps below, nothing else in that directory.

## Steps

1. **Read AGENTS.md § 6 (Conventions / Prompts) and docs/prompts.md** to confirm the workflow.

2. **Identify current version**
   - Read `packages/agent/src/prompts/index.ts` to find the active version string (e.g. `"v0.3"`)
   - Parse the major and minor numbers

3. **Compute new version**
   - If $ARGUMENTS first word is `minor`: bump minor (`v0.3` → `v0.4`)
   - If $ARGUMENTS first word is `major`: bump major, reset minor (`v0.3` → `v1.0`)
   - Otherwise: ask the human which kind of bump and stop

4. **Copy the current version file**
   - Source: `packages/agent/src/prompts/versions/system-v<old>.ts`
   - Destination: `packages/agent/src/prompts/versions/system-v<new>.ts`
   - Do not modify the contents — the human will edit the new file

5. **Update the index**
   - In `packages/agent/src/prompts/index.ts`, change the import and export to point to the new version

6. **Add an entry to docs/prompts.md**
   - Insert above the previous version's entry, format:
     ```markdown
     ### v<new> — <summary from $ARGUMENTS, or "WIP">

     - **Date**: <today YYYY-MM-DD>
     - **Author**: <git user.name>
     - **Change**: <summary or "TBD">
     - **Eval impact**: TBD — run evals on branch `eval/prompt-v<new>`
     ```

7. **Report**
   - List files changed
   - Tell the human:
     ```
     Bumped prompt to v<new>. Next steps:
     1. Edit packages/agent/src/prompts/versions/system-v<new>.ts
     2. Commit on branch eval/prompt-v<new>
     3. Push to trigger eval CI
     4. Update docs/prompts.md with eval delta before merging
     ```

## Don't

- Don't modify the contents of the new version file — the human writes prompts.
- Don't modify the old version file. Ever.
- Don't commit.
- Don't run evals — that's a separate command (`/run-eval`).
