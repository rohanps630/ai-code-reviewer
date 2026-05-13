---
description: Run all quality checks (lint, typecheck, test) and report
---

# Pre-commit quality check

Run all quality gates and produce a clean summary.

## Steps

1. **Run in order, capturing output**
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   cd apps/indexer && uv run ruff check . && uv run ruff format --check . && uv run pytest
   ```

2. **Aggregate results**
   - Track which steps passed/failed
   - Capture the first 3 errors from each failed step

3. **Report**

   Format as:
   ```
   ## Quality check results

   - ✅ Biome lint
   - ✅ TypeScript typecheck
   - ❌ Vitest (3 failing)
   - ✅ Ruff lint
   - ✅ Ruff format
   - ✅ pytest

   ### Failures

   #### Vitest
   <first 3 errors with file:line>
   ```

4. **Verdict line**
   - If all pass: `✅ Ready to commit.`
   - If any fail: `❌ Fix the failures above before committing.`

## Don't

- Don't auto-fix anything. Show what's wrong, let the human decide.
- Don't suggest `--no-verify` or other ways to skip checks.
