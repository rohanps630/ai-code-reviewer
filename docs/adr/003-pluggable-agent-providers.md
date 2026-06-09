# 003 — Provider-agnostic `Agent` abstraction

**Status**: Accepted
**Date**: 2026-06-09
**Deciders**: Rohan P Suresh

## Context

Phase 3 shipped `runReview` (`packages/agent/src/loop.ts`) — a hand-written
ReAct loop purpose-built for code review. It is hardwired to:

- Anthropic only (`@anthropic-ai/sdk`, `MODEL_IDS = { haiku, sonnet, opus }`),
- the versioned `CURRENT_SYSTEM_PROMPT`,
- a fixed tool set + the `submit_review` termination sentinel, and
- a structured `ReviewOutput` (findings with category/severity) that the web
  UI, the `reviews` table, and the entire eval harness depend on.

That specialization is correct for the review product, and `loop.ts` /
`prompts/` / `retrieval/` are **protected** (AGENTS.md § 7).

Separately, we want a **general-purpose, declarative agent primitive** in the
style of the AWS Strands Agents SDK and Google ADK — an industry-familiar shape:

```ts
const agent = new Agent({
  model: "claude-sonnet-4-7",          // or anthropic(...) / openai(...) / google(...)
  tools: [searchCodeTool, readFileTool],
  systemPrompt: "You are the reviewer...",
});
const answer = await agent.run("review this diff"); // Promise<string>
```

The key requirement is **model-agnosticism**: the same `Agent` and the same
tools must run on Anthropic, OpenAI, Google, or any future provider, swapping
only the `model` argument. Two of those providers (OpenAI as the documented
fallback in AGENTS.md § 3, and Google/Gemini) are new to the codebase, so this
is a stack-level decision that requires an ADR.

## Decision

1. **Add a provider seam.** A `ModelProvider` interface
   (`packages/agent/src/providers/`) normalizes a single inference step:
   provider-neutral `ModelMessage[]` + `ToolSpec[]` in, `{ text, toolCalls,
   usage, stopReason }` out. Each provider ships a thin adapter that translates
   to/from its SDK wire format. Adapters take an **injected client** (DI, like
   the rest of the package) and can lazily construct a default client from an
   API key.

2. **Add a declarative `Agent` class** (`packages/agent/src/agent.ts`) that owns
   the provider-agnostic ReAct loop: call model → if tool calls, execute via the
   existing tool registry and feed results back → repeat until the model answers
   with no tool calls (or `maxIterations` is hit). `run(input: string):
   Promise<string>` returns the final assistant text.

3. **This is purely additive.** `loop.ts`, `prompts/`, and `retrieval/` are not
   touched. `runReview` remains the code-review entry point with its structured
   output. The `Agent` class reuses the **protected tool framework by importing
   it** (`buildToolRegistry`, `executeToolCall`, the `Tool` type) — never by
   modifying it.

4. **Add `openai` and `@google/genai` as dependencies.** Anthropic stays on the
   already-present `@anthropic-ai/sdk`. OpenAI is the § 3 fallback; Google/Gemini
   is added here. All three SDKs are lazy-imported so they load only when a
   provider is actually used.

5. **Model strings resolve by prefix** (`claude-*` → Anthropic, `gpt-*`/`o*` →
   OpenAI, `gemini-*` → Google), so the `new Agent({ model: "gemini-2.5-pro" })`
   ergonomics work, while passing a provider object stays fully supported for
   custom configuration.

## Consequences

### Positive

- One `Agent` + one tool definition runs on any provider; switching is a
  one-argument change.
- Familiar, industry-standard surface (Strands / ADK / Vercel AI SDK lineage).
- Zero risk to the shipped review pipeline — the protected loop is untouched and
  its evals keep passing unchanged.
- The tool framework is reused, not forked.

### Negative

- Two new dependencies (`openai`, `@google/genai`) and a normalization layer to
  maintain as provider wire formats evolve.
- Two agent loops now coexist (`runReview` and `Agent`). They share the tool
  framework but not the orchestration. If the review product later wants
  provider-agnosticism, `runReview` could be re-expressed on top of `Agent` —
  out of scope here and gated on a separate ask (protected path).

### Neutral

- `Agent.run` returns a plain `string` (the model's final text). It does **not**
  produce the structured `ReviewOutput`; callers that need findings should keep
  using `runReview`, or define a `submit`-style tool and parse its input.
- Adapters are unit-tested on request/response translation against injected fake
  clients; live-API behavior per provider is verified separately (manual / evals).

## Alternatives considered

### Alternative A: Make `runReview` itself pluggable

Rejected. `loop.ts` is protected and tightly coupled to the structured review
contract. Generalizing it in place risks the shipped product for an unrelated
capability. Additive is safer and keeps both concerns clean.

### Alternative B: Adopt Vercel AI SDK 5 as the provider layer

Vercel AI SDK (already in the stack for web streaming) abstracts providers via
`LanguageModel` and could back the loop. Rejected for the agent core because the
project's stated value (AGENTS.md § 1) is that the agent loop is *our* code, not
a wrapped framework; a thin `ModelProvider` seam keeps the orchestration legible
and the dependency surface explicit. The web app continues to use the AI SDK for
its own streaming.

## References

- AWS Strands Agents SDK — `Agent(model, tools, system_prompt)` shape
- Google Agent Development Kit (ADK) — `LlmAgent` + model registry
- AGENTS.md §§ 1, 3, 6, 7 (protected paths, stack, version policy)
- `docs/adr/001-stack-choices.md`
