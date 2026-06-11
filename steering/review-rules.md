# Review System Rules

These rules apply when modifying the core AI Code Reviewer logic, agent loops, retrieval pipelines, or evaluations.

## 1. Prompt Versioning
- Prompts in `packages/agent/src/prompts/versions/` are versioned artifacts.
- NEVER edit a published prompt version in place. You must bump it to the next version and log the change in `docs/prompts.md`.

## 2. Tools
- Tools must be pure-ish: inputs mapped to outputs via Zod schemas.
- Do not add new agent tools without explicit human direction.

## 3. Evaluations
- Do not write standard unit tests that assert on LLM output text content.
- LLM output must be tested via the eval harness (`apps/indexer/src/evals/`). Mock LLMs only for structure/error handling tests.
