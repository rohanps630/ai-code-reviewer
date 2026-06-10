/**
 * Langfuse observability adapter for the `@acr/agent` runtime.
 *
 * Maps the runtime's lifecycle hooks onto Langfuse: each model call becomes
 * a Langfuse **generation** (with token usage + cache metadata), and each
 * tool call becomes a Langfuse **event** under the same span.
 *
 * Built and unit-tested in isolation (ADR-005 Phase 3). The live
 * `/api/reviews` route is NOT rewired here — it keeps its existing
 * traced-provider wrapper until callers migrate deliberately.
 *
 * Usage:
 *   const span = trace.span({ name: "agent-run" });
 *   const agent = new Agent({ ..., hooks: langfuseHooksAdapter(span) });
 */

import type { AgentHooks } from "@acr/agent";

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
        input: ctx.messages,
        metadata: { iteration: ctx.iteration, runId: ctx.runId },
      });
    },
    afterModelCall: (ctx) => {
      generation?.end({
        output: ctx.response.text || ctx.response.toolCalls,
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
        input: ctx.toolCall.input,
        output: ctx.output,
        level: ctx.isError ? "ERROR" : "DEFAULT",
        metadata: { durationMs: ctx.durationMs, iteration: ctx.iteration, runId: ctx.runId },
      });
    },
  };
}
