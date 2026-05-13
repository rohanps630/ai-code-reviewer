---
description: Add a new example to the eval dataset
argument-hint: <pr-url>
---

# Add eval example from: $ARGUMENTS

Your job: take a real GitHub PR URL, extract the diff and the substantive review feedback from the discussion, and add it as a new example to the current eval dataset.

## Steps

1. **Read context**
   - Read `docs/evals.md` to understand the dataset format
   - Read `evals/datasets/v1/examples.jsonl` to see existing examples
   - Read AGENTS.md § 7 — note the rule about not asserting on LLM content directly

2. **Fetch the PR**
   - Use GitHub API or the URL provided in $ARGUMENTS
   - Extract:
     - PR title and description
     - The diff (unified format)
     - Substantive review comments that identified real issues (skip nits, formatting comments, "LGTM" approvals)
     - The final state (was the issue fixed? merged? abandoned?)

3. **Build the example**
   - Schema (matches existing entries in the dataset):
     ```json
     {
       "id": "<slug>",
       "pr_url": "<full URL>",
       "pr_title": "...",
       "pr_diff": "...",
       "ground_truth": {
         "findings": [
           {
             "category": "bug" | "perf" | "security" | "style" | "logic",
             "severity": "critical" | "major" | "minor",
             "summary": "<one sentence>",
             "location_hint": "<file:line or function name>",
             "source_comment_url": "<link to the reviewer's comment>"
           }
         ],
         "expected_findings_count": <number>,
         "false_positive_traps": ["<things a naive agent might flag but shouldn't>"]
       },
       "difficulty": "easy" | "medium" | "hard",
       "added_at": "<ISO date>",
       "added_by": "<your handle>"
     }
     ```

4. **Append to the dataset**
   - Append a single line of JSON to `evals/datasets/v1/examples.jsonl`
   - Do not reformat or rewrite the existing file

5. **Update metadata**
   - Increment example count in `evals/datasets/v1/README.md`

6. **Commit**
   - Use commit type `eval`: `eval(dataset): add example <slug>`
   - This branch should be `eval/<slug>` so CI knows to run the eval workflow

## Quality bar

- ✅ Skip PRs where the reviewer was wrong or the discussion devolved.
- ✅ Skip PRs that are pure refactors with no behavior change.
- ✅ Prefer PRs where the diff is < 500 lines (longer ones are too noisy for now).
- ✅ Aim for a mix of difficulties across the dataset.
- ❌ Don't include trivial style/lint findings as ground truth.
- ❌ Don't include subjective taste comments as ground truth.
