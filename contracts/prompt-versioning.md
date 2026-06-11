# Prompt Versioning Contract

This contract defines the strict rules governing the lifecycle, structure, and evaluation of System Prompts used by the AI Code Reviewer.

## 1. Immutable Versions
**Prompts are versioned artifacts.** Once a prompt version has been committed and used in an evaluation run, it must NEVER be edited in place. 

If changes are required:
1. Duplicate the current prompt (e.g., `system-v0.3.ts` -> `system-v0.4.ts`).
2. Make your edits in the new file.
3. Update the default export in `packages/agent/src/prompts/index.ts` to point to the new version.

## 2. Versioning Semantic Rules
- **Major** (e.g., v1.0 to v2.0): Significant architectural changes such as adding/removing tools, completely changing the output schema, or adding new persona directives.
- **Minor** (e.g., v0.3 to v0.4): Refinements, phrasing tweaks, or adding few-shot examples without altering the structural API surface of the prompt.

## 3. Required Prompt Anatomy
Every system prompt must contain the following components in order:
1. **Role**: The persona definition (e.g., "You are a senior code reviewer...").
2. **Objective**: Explicit definition of a successful review.
3. **Tools Description**: The exact list of available tools, when to use them, and the explicit `submit_review` termination tool.
4. **Output Schema**: Explicit instructions mapping to the Zod validation schema.
5. **Style Guidance**: Tone instructions (terse, grounded in code).
6. **False-Positive Heuristics**: Negative examples defining what *not* to flag.
7. **Few-Shot Examples**: Concrete examples.

## 4. Evaluation Gate
A new prompt version cannot be deployed to `main` unless it has passed the evaluation harness (`apps/indexer/src/evals/`). 
- **Constraint**: The new prompt must not regress the baseline LLM-as-judge score by more than 3%, and must not increase cost by more than 20% compared to the prior version.
- **Logging**: The change and its eval delta must be documented in `docs/prompts.md`.
