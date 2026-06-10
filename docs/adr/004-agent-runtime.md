# 004 — `Agent` as a production-grade runtime; `runReview` rebuilt on it

**Status**: Accepted
**Date**: 2026-06-10
**Deciders**: Rohan P Suresh

## Context

ADR-003 added a declarative, model-agnostic `Agent` (`packages/agent/src/agent.ts`)
as a clean ReAct kernel, deliberately additive and with **zero production call
sites**. In parallel, the shipped code-review loop (`packages/agent/src/loop.ts`,
protected) hand-rolls everything the kernel lacks: usage/cost accounting, a cost
cap, a structured-termination sentinel (`submit_review`), per-iteration status
events, and a typed `ReviewChunk` stream.

The result is two loops with overlapping concerns and a kernel too thin to host
the production loop. ADR-003 itself anticipated this (its Consequences note: *"If
the review product later wants provider-agnosticism, `runReview` could be
re-expressed on top of `Agent` — out of scope here and gated on a separate
ask"*). This is that ask.

This ADR promotes `Agent` into a **production-grade agent runtime** — adding the
safety, visibility, and integration features a real loop needs — and then
**rebuilds `runReview` as a thin specialization of it**, deleting the duplicated
orchestration. Design references: AWS Strands (typed event loop, hooks) and
Google ADK (event streams, run config). We mirror their *concepts*, adapted to
this codebase's idioms; no third-party agent code is imported.

## Decision

### 1. Tiered roadmap

Build the **Critical** and **Important** tiers now. Document the **Future** tier
without implementing it — scope discipline keeps the runtime legible and the
dependency surface explicit.

| Tier | Items | Status after this work |
|---|---|---|
| 1 — Critical | typed `stream()` event loop, usage + cost accounting + spend cap, end-to-end `AbortSignal` cancellation, timeouts (model/tool/run), error taxonomy, tool-output truncation, tool concurrency cap, structured termination (`stopTool`) | **Implemented** |
| 2 — Important | hooks (`before/afterModelCall`, `before/afterToolCall` with skip/veto), multi-turn (`ModelMessage[]` in, full transcript out), Langfuse observability adapter, `runReview` rebuilt on `Agent` | **Implemented** |
| 3 — Future | token-level streaming through the provider seam; context compaction near the window limit; Anthropic prompt-cache breakpoints; Zod-schema → auto-generated `stopTool`; per-run tool allowlists + human-approval UI; persistent sessions/memory; cross-provider contract test suite | **Documented only** |

### 2. Public API sketch

```ts
// Construction — superset of the ADR-003 config; every new field optional.
new Agent({
  model,                       // ModelLike (provider object or model-id string)
  tools,                       // readonly AgentTool[]
  systemPrompt,
  maxIterations,               // default 10
  maxTokens,                   // default 4096
  pricing,                     // { input, output } USD/Mtok — enables cost + cap
  costCapUsd,                  // throws AgentCostCapError when exceeded
  timeouts,                    // { modelCallMs?, toolCallMs?, runMs? }
  maxToolResultChars,          // default 30_000 — truncate tool output fed to model
  maxConcurrentTools,          // default 4 — semaphore over a tool batch
  stopTool,                    // { name, description, inputSchema, validate } — structured termination
  hooks,                       // before/afterModelCall, before/afterToolCall
})

// Streaming event loop — the new primitive. run() is a thin drain of this.
agent.stream(input, { signal }): AsyncGenerator<AgentEvent>
agent.run(input, { signal }): Promise<string>     // unchanged signature; drains stream()

// input: string | ModelMessage[]  (multi-turn: pass the prior transcript back)
```

`AgentEvent` is an exported discriminated union; every event carries
`runId: string` (a `crypto.randomUUID()` per run) and `timestamp: number`:

```
run_start        { inputSummary, modelId, maxIterations }
model_call_start { iteration }
model_response   { iteration, text, toolCallCount, usage: TokenUsage }
tool_call        { name, input }
tool_result      { name, output, isError, durationMs }
final            { text, stopToolInput?, usage: AccumulatedUsage, iterations, stopReason, messages }
run_error        { errorName, message }            // emitted just before the error is thrown
```

`stopReason` is `"answer"` (model stopped with no tool calls — only legal when no
`stopTool` is configured) or `"stop_tool"` (model called the configured stop
tool). `AccumulatedUsage` totals `inputTokens`, `outputTokens`,
`cacheReadTokens`, `cacheCreationTokens`, and `costUsd`.

#### Error taxonomy

```
AgentError (abstract)  — carries { runId, usage } (partial usage at throw time)
├── AgentMaxIterationsError       (re-parented from ADR-003; name preserved)
├── AgentCostCapError             { costUsd, capUsd, iteration }
├── AgentAbortedError             (external AbortSignal fired)
├── AgentTimeoutError             { budget: "model" | "tool" | "run" }
└── AgentStopToolValidationError  (stopTool.validate threw; original error in `cause`)
```

Provider errors (`ProviderError`) pass through untouched.

#### Hooks

```ts
hooks: {
  beforeModelCall?: (ctx) => void | Promise<void>;
  afterModelCall?:  (ctx) => void | Promise<void>;
  beforeToolCall?:  (ctx) => void | { skip: string } | Promise<…>;  // skip ⇒ tool not run; string fed back as the result
  afterToolCall?:   (ctx) => void | Promise<void>;
}
```

Hook errors **fail the run** — hooks are guardrails, not best-effort logging.
`beforeToolCall`'s `{ skip }` path is the human-approval / policy seam.

### 3. `runReview` rebuilt on `Agent` (loop.ts)

`runReview` configures one `Agent`:

- `systemPrompt = CURRENT_SYSTEM_PROMPT`; tools built from the existing registry
  factories (`createSearchCodeTool`, …);
- `stopTool = submit_review` with `validate = validateReviewOutput`;
- `pricing` looked up from `models.ts` by `deps.provider.modelId`;
- `costCapUsd` / `maxIterations` from deps;
- `model = deps.provider`.

It then maps `AgentEvent`s → `ReviewChunk`s and translates the runtime's typed
errors back to the **exact legacy messages** (cost cap, max iterations,
no-tool-call turn, `validateReviewOutput` failures). The public `runReview`
signature, the full `ReviewChunk` sequence, and every error message/type are
preserved — `loop-agent.test.ts`, `loop.test.ts`, and all `apps/web` tests pass
unchanged. The duplicated loop machinery is deleted.

The tier/pricing tables move from `loop.ts` to a new, unprotected
`packages/agent/src/models.ts` so both `runReview` and the runtime read one
source. `MODEL_TIERS` + `resolveModelId` keep their behavior; `defaultDeps`,
`routeModel`, `buildOpeningMessage`, `sanitizeUntrustedText`,
`validateReviewOutput`, and `_resetForTests` are unchanged beyond their imports.

### 4. Provider seam

`ModelRequest` gains an optional `signal?: AbortSignal`, threaded through every
adapter to its SDK/`fetch` call (all SDKs accept a signal). The field is
optional and additive — existing provider tests pass unchanged.

## Consequences

### Positive

- One runtime owns safety (cost cap, timeouts, abort), visibility (typed event
  stream), and integration (hooks, multi-turn). The review loop becomes a
  declarative configuration of it.
- `runReview` shrinks to a mapping layer; the orchestration is tested once, in
  the runtime, with scripted providers.
- The event stream and hooks give the web app and Langfuse a single, typed
  integration surface instead of bespoke wiring per call site.

### Negative

- `loop.ts` internals are rewritten (authorized, one-time, under a strict parity
  contract). The risk is contained by the frozen parity tests.
- The runtime is now a larger, more featureful class — more surface to keep
  correct. Mitigated by exhaustive scripted-provider tests (Phase 5).

### Neutral

- The Langfuse adapter is built and unit-tested but **not** wired into the live
  route in this change; the route keeps its existing traced-provider until
  callers migrate deliberately.
- `Agent.run` still returns the final assistant text (now a drain of
  `stream()`); structured output is obtained via a `stopTool`, exactly as
  `runReview` now does.

## Future tier — design intent (not implemented)

- **Token-level streaming through the provider seam.** Today a provider returns a
  whole `ModelResponse`; `model_response` carries the full text. A future
  `generateStream()` would yield deltas the runtime re-emits as `text_delta`
  events. Deferred: it touches every adapter and the SSE contract, and the
  product streams at the `ReviewChunk` granularity already.
- **Context compaction near the window limit.** When the transcript approaches the
  model's context window, summarize or drop the oldest turns. Deferred until we
  observe real runs hitting the limit; doing it blind risks dropping context the
  model needs.
- **Anthropic prompt-cache breakpoints.** Place explicit `cache_control` markers
  on stable prefixes (system prompt, tool specs) to cut cost. The accounting
  already handles cache tokens; the placement policy is provider-specific and
  belongs behind the seam, not in the loop.
- **Zod-schema → auto-generated `stopTool`.** Derive `inputSchema` + `validate`
  from one Zod schema so callers don't hand-write both. Ergonomic only; the
  explicit shape is clearer to ship first.
- **Per-run tool allowlists + human-approval UI.** `beforeToolCall`'s `skip` seam
  is the hook; a future allowlist + approval queue would build a UI on top.
  Deferred: needs product/UX design, not just runtime plumbing.
- **Persistent sessions / memory.** Multi-turn today is stateless — the caller
  passes the transcript back. Durable sessions (store + resume by id) need a
  storage contract and eviction policy; out of scope.
- **Cross-provider contract test suite.** A shared suite asserting every adapter
  honors the seam identically (signal handling, usage shape, stop-reason
  mapping). High value as providers grow; deferred until there are more than the
  current five.

## Relationship to ADR-003

**Supersedes-in-part.** ADR-003 stands as the rationale for the provider seam and
the declarative `Agent`. This ADR supersedes its Consequences note that
`runReview` remaining a separate loop is "out of scope" — that scope is now
explicitly authorized and delivered here. The provider seam, the model-string
prefix routing, and the "tool framework is reused, not forked" principle are
unchanged.

## References

- AWS Strands Agents SDK — event loop, hooks, agent run lifecycle
- Google Agent Development Kit (ADK) — event streams, `RunConfig`
- `docs/adr/003-pluggable-agent-providers.md`
- `docs/guidelines.md` §§ 6, 7 (conventions, protected paths)
