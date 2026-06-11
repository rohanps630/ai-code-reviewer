# Never Do

> **These rules act as hard constraints for the system. They will be rejected in review every time. No exceptions.**

- ❌ **Never modify `packages/agent/src/loop.ts`, `packages/agent/src/prompts/`, or `packages/agent/src/retrieval/`** unless the human explicitly asks. Treat them as owned by the human; if a task seems to need a change here, stop and surface it.
- ❌ Never commit secrets or hardcode API keys.
- ❌ Never edit a published prompt version in place — bump to next version.
- ❌ Never write tests that assert on LLM output **content** directly. That's what evals are for. Mock LLMs only for shape/error tests.
- ❌ Never use `pip` or `pip install`. Use `uv`.
- ❌ Never use `npm` or `yarn`. Use `pnpm`.
- ❌ Never introduce a new dependency without justification in the PR description.
- ❌ Never disable typecheck or lint to ship faster.
- ❌ Never write code that bypasses Zod validation at API boundaries.
- ❌ Never commit `.env*` files (other than `.env.example`).
- ❌ Never let the `scripts/cli.mjs` menu fall out of sync with the actual scripts — add the entry in the same commit as the new command, don't defer it.
