---
description: Run the eval harness against the current agent version and report results
argument-hint: [dataset-version]
---

# Run evals

Run the eval harness and produce a summary the human can act on. If $ARGUMENTS is empty, default to dataset `v1`.

## Steps

1. **Read context**
   - Read `docs/evals.md` for the current eval methodology
   - Read `packages/agent/src/prompts/index.ts` to identify the current prompt version
   - Note current git HEAD SHA — it'll be the `agent_version` label

2. **Execute the eval run**
   ```bash
   cd apps/indexer
   uv run python -m evals.cli run \
     --dataset ${1:-v1} \
     --agent-version "$(git rev-parse --short HEAD)" \
     --prompt-version "<read from packages/agent/src/prompts/index.ts>"
   ```

3. **Wait for completion**
   - Stream output to the terminal
   - Do not parallelize beyond the eval runner's built-in concurrency
   - Abort if cost exceeds $10 (sanity check)

4. **Read results**
   - Results are written to `evals/results/<run-id>/summary.json`
   - Pull out:
     - Total examples run
     - Mean judge score (LLM-as-judge)
     - Mean deterministic score (did we find the ground-truth bug?)
     - False positive count
     - P50 and P95 latency
     - Total cost
     - Cost per review

5. **Compare to previous run**
   - Find the most recent prior run in `evals/results/`
   - Compute deltas for every metric above
   - Flag any regression > 5% on quality scores or > 20% on cost

6. **Report to human**
   - Format as a markdown table
   - Include a one-line verdict: "✅ ship it", "⚠️ regression on X", or "❌ blocked, investigate Y"
   - Link to the Braintrust run if available (URL in `summary.json`)
   - Suggest a `git commit` message that captures the result, e.g.
     `eval(run): prompt v0.4, judge +3%, cost -12%`

## Don't

- Don't modify any agent code, prompt, or dataset during this command.
- Don't auto-commit. Surface the suggested message, let the human run `git commit`.
- Don't open a PR. Surface the diff (if any from prompt changes) so the human reviews.
