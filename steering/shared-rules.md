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
