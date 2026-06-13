/**
 * Langfuse observability adapter for the `@acr/agent` runtime.
 *
 * Maps the runtime's lifecycle hooks onto Langfuse: each model call becomes
 * a Langfuse **generation** (with token usage + cache metadata), and each
 * tool call becomes a Langfuse **event** under the same span.
 *
 * Introduced in ADR-005 Phase 3 and wired into the live `/api/reviews`
 * review stream (lib/review-stream.ts), which passes these hooks through
 * `runReview` deps instead of wrapping the provider. This replaced the old
 * traced-provider wrapper.
 *
 * Usage:
 *   const span = trace.span({ name: "agent-run" });
 *   await runReview(input, { ...deps, hooks: langfuseHooksAdapter(span) });
 *   // or directly: new Agent({ ..., hooks: langfuseHooksAdapter(span) });
 */

import type { AgentHooks } from "@acr/agent";

/** Per-string cap for trace payloads. The opening message carries the full
 *  diff (up to 500 KB) and tool results can be whole files; logging them
 *  verbatim ships hundreds of KB per generation to Langfuse and double-stores
 *  potentially sensitive code. We cap each string and note what was dropped. */
const MAX_TRACE_STRING_LEN = 2_000;
const MAX_TRACE_DEPTH = 6;

/**
 * Recursively truncate long strings in a trace payload while preserving its
 * structure. Bounded in depth so a pathological object can't blow the stack.
 */
function truncateForTrace(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    if (value.length <= MAX_TRACE_STRING_LEN) return value;
    const dropped = value.length - MAX_TRACE_STRING_LEN;
    return `${value.slice(0, MAX_TRACE_STRING_LEN)}…(${dropped} more chars truncated)`;
  }
  if (depth >= MAX_TRACE_DEPTH || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => truncateForTrace(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = truncateForTrace(v, depth + 1);
  return out;
}

/** Minimal structural shape of a Langfuse generation handle. */
export type LangfuseGenerationLike = {
  update(body: Record<string, unknown>): void;
  end(body?: Record<string, unknown>): void;
};

/** Minimal structural shape of the Langfuse span we attach to. A real
 *  `LangfuseSpanClient` satisfies this; tests inject a fake. */
export type LangfuseSpanLike = {
  generation(body: Record<string, unknown>): LangfuseGenerationLike;
  event(body: Record<string, unknown>): unknown;
};

/**
 * Build `AgentHooks` that record a run onto `span`. Model calls open a
 * generation on `beforeModelCall` and close it (with usage) on
 * `afterModelCall`; tool calls are logged as events on `afterToolCall`.
 *
 * The loop is sequential (each iteration awaits the previous), so a single
 * in-flight generation reference is sufficient and race-free.
 */
export function langfuseHooksAdapter(span: LangfuseSpanLike): AgentHooks {
  let generation: LangfuseGenerationLike | null = null;

  return {
    beforeModelCall: (ctx) => {
      generation = span.generation({
        name: "llm-call",
        model: ctx.modelId,
        input: truncateForTrace(ctx.messages),
        metadata: { iteration: ctx.iteration, runId: ctx.runId },
      });
    },
    afterModelCall: (ctx) => {
      generation?.end({
        output: truncateForTrace(ctx.response.text || ctx.response.toolCalls),
        usage: {
          input: ctx.response.usage.inputTokens,
          output: ctx.response.usage.outputTokens,
        },
        metadata: {
          cacheReadTokens: ctx.response.usage.cacheReadTokens,
          cacheCreationTokens: ctx.response.usage.cacheCreationTokens,
          cumulativeCostUsd: ctx.usage.costUsd,
        },
      });
      generation = null;
    },
    afterToolCall: (ctx) => {
      span.event({
        name: `tool:${ctx.toolCall.name}`,
        input: truncateForTrace(ctx.toolCall.input),
        output: truncateForTrace(ctx.output),
        level: ctx.isError ? "ERROR" : "DEFAULT",
        metadata: { durationMs: ctx.durationMs, iteration: ctx.iteration, runId: ctx.runId },
      });
    },
    onRunError: (ctx) => {
      // A model call that threw skips afterModelCall, leaving its generation
      // open. Close it with the error so nothing dangles in Langfuse. (If the
      // failure happened after a clean model call — cost cap, etc. — there's
      // no open generation and this is a no-op.)
      if (generation) {
        generation.end({
          level: "ERROR",
          statusMessage: ctx.error instanceof Error ? ctx.error.message : String(ctx.error),
          metadata: { runId: ctx.runId, cumulativeCostUsd: ctx.usage.costUsd },
        });
        generation = null;
      }
    },
  };
}
