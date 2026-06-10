/**
 * Agent — a declarative, model-agnostic agent runtime.
 *
 * Inspired by AWS Strands (typed event loop, agent lifecycle) and Google
 * ADK (event streams, run config): configure once, then `stream()` a typed
 * event loop or `run()` for just the final text. The same `Agent` and the
 * same tools run on any provider (Anthropic, OpenAI, Google, …) — swap only
 * the `model`.
 *
 *   const agent = new Agent({
 *     model: "claude-sonnet-4-7",            // or anthropic(...) / openai(...) / google(...)
 *     tools: [searchCodeTool, readFileTool],
 *     systemPrompt: "You are the reviewer...",
 *   });
 *   const answer = await agent.run("Review this diff: ...");
 *
 *   for await (const ev of agent.stream("Review this diff: ...", { signal })) {
 *     // ev: run_start | model_call_start | model_response | tool_call |
 *     //     tool_result | final | run_error
 *   }
 *
 * The loop is ReAct-shaped: model → if it requested tools, execute them and
 * feed results back → repeat until the model answers with no tool calls (or
 * calls the configured `stopTool`), `maxIterations` is reached, the cost cap
 * trips, a timeout elapses, or the run is aborted.
 *
 * This runtime is the production primitive: `runReview` (loop.ts) is a thin
 * specialization of it (ADR-005). It reuses the tool framework by importing
 * it — see docs/adr/003-pluggable-agent-providers.md and 005-agent-runtime.md.
 */

import { randomUUID } from "node:crypto";

import {
  type AccumulatedUsage,
  AgentAbortedError,
  AgentCostCapError,
  type AgentEvent,
  type AgentHooks,
  AgentMaxIterationsError,
  AgentNoStopToolError,
  type AgentRunOptions,
  AgentStopToolValidationError,
  AgentTimeoutError,
  type AgentTimeouts,
  type StopToolConfig,
  type TimeoutBudget,
  zeroUsage,
} from "./agent-types.js";
import { type ModelLike, type ModelProvider, resolveModel } from "./providers/index.js";
import type {
  ModelMessage,
  ModelRequest,
  ModelResponse,
  TokenUsage,
  ToolCall,
  ToolSpec,
} from "./providers/index.js";
import { type Tool, type ToolRegistry, buildToolRegistry, executeToolCall } from "./tools/index.js";
import type { JsonSchemaObject } from "./tools/index.js";

export type {
  AgentEvent,
  AgentRunOptions,
  AccumulatedUsage,
  AgentStopReason,
  AgentTimeouts,
  AgentHooks,
  BeforeModelCallContext,
  AfterModelCallContext,
  BeforeToolCallContext,
  AfterToolCallContext,
  SkipToolDecision,
  RunErrorContext,
  StopToolConfig,
} from "./agent-types.js";
export {
  AgentError,
  AgentMaxIterationsError,
  AgentCostCapError,
  AgentAbortedError,
  AgentTimeoutError,
  AgentNoStopToolError,
  AgentStopToolValidationError,
} from "./agent-types.js";

const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MODEL_TIMEOUT_MS = 120_000;
const DEFAULT_TOOL_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 30_000;
const DEFAULT_MAX_CONCURRENT_TOOLS = 4;
const INPUT_SUMMARY_MAX = 200;

/**
 * A tool the `Agent` can call. Structurally compatible with the package's
 * `Tool<TInput, TOutput>` (so `createSearchCodeTool(...)` et al. pass
 * directly) while staying covariant enough to hold a mixed array without
 * casts at the call site.
 */
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaObject;
  readonly inputValidator: ZodLike;
  readonly outputValidator: ZodLike;
  readonly execute: (input: never) => Promise<unknown>;
}

/** Minimal structural shape of the Zod validators a tool carries. */
type ZodLike = { safeParse: (input: unknown) => unknown };

export interface AgentConfig {
  /** A provider object, or a model-id string resolved by prefix. */
  readonly model: ModelLike;
  /** Tools the agent may call. Omit for a tool-less, single-shot agent. */
  readonly tools?: readonly AgentTool[];
  /** System instructions. */
  readonly systemPrompt?: string;
  /** Hard cap on model↔tool round-trips before giving up. Default 10. */
  readonly maxIterations?: number;
  /** Per-call token ceiling passed to the provider. Default 4096. */
  readonly maxTokens?: number;
  /** USD per million tokens. When set, the run accumulates cost and the
   *  cap (if any) is enforced. Absent ⇒ cost stays 0 and the cap is off. */
  readonly pricing?: { readonly input: number; readonly output: number };
  /** Throw `AgentCostCapError` once accumulated cost reaches this (USD).
   *  Requires `pricing`; checked after tool execution, before the next call. */
  readonly costCapUsd?: number;
  /** Per-phase timeout budgets. Defaults: model 120s, tool 120s, run ∞. */
  readonly timeouts?: AgentTimeouts;
  /** Serialized tool results longer than this are truncated (with a marker)
   *  before being fed to the model. The full output still rides the
   *  `tool_result` event. Default 30_000. */
  readonly maxToolResultChars?: number;
  /** Max tools run concurrently within one iteration's batch. Default 4. */
  readonly maxConcurrentTools?: number;
  /** Structured-termination tool: appended to specs, never executed. */
  readonly stopTool?: StopToolConfig;
  /** Lifecycle hooks (before/after model + tool calls). Hook errors fail
   *  the run; `beforeToolCall` may veto a tool via `{ skip }`. */
  readonly hooks?: AgentHooks;
}

export class Agent {
  private readonly model: ModelProvider;
  private readonly systemPrompt?: string;
  private readonly maxIterations: number;
  private readonly maxTokens: number;
  private readonly pricing?: { readonly input: number; readonly output: number };
  private readonly costCapUsd?: number;
  private readonly timeouts: AgentTimeouts;
  private readonly maxToolResultChars: number;
  private readonly maxConcurrentTools: number;
  private readonly stopTool?: StopToolConfig;
  private readonly hooks?: AgentHooks;
  private readonly toolSpecs: readonly ToolSpec[];
  /** Built once at construction — immutable (ReadonlyMap), so it's safe to
   *  reuse across every run (and across concurrent runs). */
  private readonly registry: ToolRegistry;

  constructor(config: AgentConfig) {
    this.model = resolveModel(config.model);
    const tools = config.tools ?? [];
    this.systemPrompt = config.systemPrompt;
    this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.pricing = config.pricing;
    this.costCapUsd = config.costCapUsd;
    this.timeouts = config.timeouts ?? {};
    this.maxToolResultChars = config.maxToolResultChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS;
    this.maxConcurrentTools = config.maxConcurrentTools ?? DEFAULT_MAX_CONCURRENT_TOOLS;
    this.stopTool = config.stopTool;
    this.hooks = config.hooks;

    // Build the registry once. This also validates tool names + uniqueness
    // eagerly, so a bad tool array fails at construction, not mid-run.
    // why: AgentTool is the covariant public shape of Tool<TInput,TOutput>;
    // the registry only reads name/validators/execute, which both share.
    this.registry = buildToolRegistry(tools as unknown as ReadonlyArray<Tool<unknown, unknown>>);

    if (this.stopTool && this.registry.has(this.stopTool.name)) {
      throw new Error(
        `stopTool name '${this.stopTool.name}' collides with a registered tool — choose a distinct name.`,
      );
    }

    // The stop tool is advertised to the model but never lives in the
    // registry (it is intercepted, not executed). It is listed last.
    const registrySpecs: ToolSpec[] = [...this.registry.values()].map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    this.toolSpecs = this.stopTool
      ? [
          ...registrySpecs,
          {
            name: this.stopTool.name,
            description: this.stopTool.description,
            inputSchema: this.stopTool.inputSchema,
          },
        ]
      : registrySpecs;

    if (this.pricing === undefined) {
      console.warn(
        `[agent] No pricing configured for model "${this.model.modelId}" — cost tracking disabled and the spend cap is off for this agent.`,
      );
    }
  }

  /** Which provider/model this agent is bound to. */
  get modelId(): string {
    return this.model.modelId;
  }

  /**
   * Run the agentic loop to completion and return the model's final text.
   * A thin drain of {@link stream}: it consumes every event and returns the
   * `final` event's text. Throws the same errors `stream` does.
   */
  async run(input: string | readonly ModelMessage[], options?: AgentRunOptions): Promise<string> {
    let text = "";
    for await (const ev of this.stream(input, options)) {
      if (ev.type === "final") text = ev.text;
    }
    return text;
  }

  /**
   * Drive the agentic loop as a typed event stream. Every event carries a
   * per-run `runId` and a `timestamp`. On failure a `run_error` event is
   * emitted and then the error is thrown (so `for await` consumers see the
   * event, and the throw still propagates).
   */
  async *stream(
    input: string | readonly ModelMessage[],
    options?: AgentRunOptions,
  ): AsyncGenerator<AgentEvent> {
    const runId = randomUUID();
    const usage = zeroUsage();
    try {
      yield* this.drive(input, options, runId, usage);
    } catch (err) {
      yield this.stamp(runId, {
        type: "run_error",
        errorName: err instanceof Error ? err.name : "Error",
        message: err instanceof Error ? err.message : String(err),
      });
      // Best-effort cleanup hook (e.g. close a dangling observability
      // generation). It must never mask the original failure.
      if (this.hooks?.onRunError) {
        try {
          await this.hooks.onRunError({ runId, error: err, usage });
        } catch (hookErr) {
          console.error(
            "[agent] onRunError hook threw (suppressed):",
            hookErr instanceof Error ? hookErr.message : String(hookErr),
          );
        }
      }
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Core loop
  // ──────────────────────────────────────────────────────────────────

  private async *drive(
    input: string | readonly ModelMessage[],
    options: AgentRunOptions | undefined,
    runId: string,
    usage: AccumulatedUsage,
  ): AsyncGenerator<AgentEvent> {
    const external = options?.signal;
    const runDeadline = this.makeRunDeadline();
    const messages: ModelMessage[] =
      typeof input === "string" ? [{ role: "user", content: input }] : [...input];

    try {
      yield this.stamp(runId, {
        type: "run_start",
        inputSummary: summarizeInput(input),
        modelId: this.model.modelId,
        maxIterations: this.maxIterations,
      });

      for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
        this.checkBoundary(external, runDeadline, runId, usage);

        yield this.stamp(runId, { type: "model_call_start", iteration });

        // Hook errors fail the run — they propagate to stream()'s catch.
        await this.hooks?.beforeModelCall?.({
          runId,
          iteration,
          modelId: this.model.modelId,
          messages,
        });

        const response = await this.callModel(
          { system: this.systemPrompt, messages, tools: this.toolSpecs, maxTokens: this.maxTokens },
          external,
          runDeadline,
          runId,
          usage,
        );

        this.accumulate(usage, response.usage);

        yield this.stamp(runId, {
          type: "model_response",
          iteration,
          text: response.text,
          toolCallCount: response.toolCalls.length,
          usage: response.usage,
        });

        await this.hooks?.afterModelCall?.({ runId, iteration, response, usage });

        messages.push({
          role: "assistant",
          content: response.text,
          toolCalls: [...response.toolCalls],
        });

        // Structured termination: the model called the stop tool.
        if (this.stopTool) {
          const stopCall = response.toolCalls.find((tc) => tc.name === this.stopTool?.name);
          if (stopCall) {
            const validated = this.validateStop(stopCall.input, runId, usage);
            yield this.stamp(runId, {
              type: "final",
              text: response.text,
              stopToolInput: validated,
              usage,
              iterations: iteration,
              stopReason: "stop_tool",
              messages,
            });
            return;
          }
        }

        const toolCalls = this.stopTool
          ? response.toolCalls.filter((tc) => tc.name !== this.stopTool?.name)
          : response.toolCalls;

        if (toolCalls.length === 0) {
          if (this.stopTool) {
            // Parity with the review loop: a stop tool is configured, so a
            // turn that calls nothing is a failure to terminate.
            throw new AgentNoStopToolError(this.stopTool.name, runId, usage);
          }
          // No stop tool ⇒ a no-tool turn is the model's final answer.
          yield this.stamp(runId, {
            type: "final",
            text: response.text,
            usage,
            iterations: iteration,
            stopReason: "answer",
            messages,
          });
          return;
        }

        // Emit all tool_call events before executing (mirrors the model's
        // batch), then execute, then emit all tool_result events.
        for (const call of toolCalls) {
          yield this.stamp(runId, { type: "tool_call", name: call.name, input: call.input });
        }

        this.checkBoundary(external, runDeadline, runId, usage);

        const results = await this.runToolBatch(toolCalls, runId, usage, iteration);

        for (const r of results) {
          yield this.stamp(runId, {
            type: "tool_result",
            name: r.name,
            output: r.eventOutput,
            isError: r.isError,
            durationMs: r.durationMs,
          });
        }

        for (const r of results) {
          messages.push({
            role: "tool",
            toolCallId: r.id,
            toolName: r.name,
            content: this.truncate(r.messageContent),
            isError: r.isError,
          });
        }

        // Cost cap: after tool execution, before the next model call.
        if (this.pricing && this.costCapUsd !== undefined && usage.costUsd >= this.costCapUsd) {
          throw new AgentCostCapError(usage.costUsd, this.costCapUsd, iteration, runId, usage);
        }
      }

      throw new AgentMaxIterationsError(this.maxIterations, runId, usage);
    } finally {
      runDeadline?.dispose();
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Model call — abort + timeout plumbing
  // ──────────────────────────────────────────────────────────────────

  private async callModel(
    request: ModelRequest,
    external: AbortSignal | undefined,
    runDeadline: RunDeadline | undefined,
    runId: string,
    usage: AccumulatedUsage,
  ): Promise<ModelResponse> {
    const controller = new AbortController();
    const disposers: Array<() => void> = [];
    let timedOut: TimeoutBudget | null = null;
    let abortedByUser = false;

    const link = (sig: AbortSignal, onAbort: () => void) => {
      if (sig.aborted) {
        onAbort();
        return;
      }
      sig.addEventListener("abort", onAbort, { once: true });
      disposers.push(() => sig.removeEventListener("abort", onAbort));
    };

    if (external)
      link(external, () => {
        abortedByUser = true;
        controller.abort();
      });
    if (runDeadline)
      link(runDeadline.signal, () => {
        timedOut = "run";
        controller.abort();
      });

    const modelMs = this.timeouts.modelCallMs ?? DEFAULT_MODEL_TIMEOUT_MS;
    const timer = setTimeout(() => {
      timedOut = "model";
      controller.abort();
    }, modelMs);
    disposers.push(() => clearTimeout(timer));

    try {
      const response = await this.model.generate({ ...request, signal: controller.signal });
      // A well-behaved provider rejects on abort; a provider that ignores
      // the signal still must not return a result we've decided to discard.
      if (controller.signal.aborted) {
        throw this.abortError(timedOut, abortedByUser, modelMs, runDeadline, runId, usage);
      }
      return response;
    } catch (err) {
      if (controller.signal.aborted) {
        throw this.abortError(timedOut, abortedByUser, modelMs, runDeadline, runId, usage);
      }
      throw err; // provider error or unrelated — pass through untouched
    } finally {
      for (const d of disposers) d();
    }
  }

  private abortError(
    timedOut: TimeoutBudget | null,
    abortedByUser: boolean,
    modelMs: number,
    runDeadline: RunDeadline | undefined,
    runId: string,
    usage: AccumulatedUsage,
  ): Error {
    if (timedOut === "model") return new AgentTimeoutError("model", modelMs, runId, usage);
    if (timedOut === "run") {
      return new AgentTimeoutError("run", runDeadline?.limitMs ?? 0, runId, usage);
    }
    if (abortedByUser) return new AgentAbortedError(runId, usage);
    // Aborted with no recorded reason — treat as a user abort.
    return new AgentAbortedError(runId, usage);
  }

  // ──────────────────────────────────────────────────────────────────
  // Tool batch — concurrency + per-tool timeout
  // ──────────────────────────────────────────────────────────────────

  private async runToolBatch(
    toolCalls: readonly ToolCall[],
    runId: string,
    usage: AccumulatedUsage,
    iteration: number,
  ): Promise<ToolExecResult[]> {
    return mapWithConcurrency(toolCalls, this.maxConcurrentTools, (call) =>
      this.runOneTool(call, runId, usage, iteration),
    );
  }

  private async runOneTool(
    call: ToolCall,
    runId: string,
    usage: AccumulatedUsage,
    iteration: number,
  ): Promise<ToolExecResult> {
    const start = Date.now();

    // beforeToolCall — the policy / human-approval seam. A `{ skip }` veto
    // means the tool is NOT executed; the string is fed back as its result
    // (and afterToolCall is skipped too).
    if (this.hooks?.beforeToolCall) {
      const decision = await this.hooks.beforeToolCall({ runId, iteration, toolCall: call });
      if (decision && "skip" in decision) {
        return {
          id: call.id,
          name: call.name,
          isError: false,
          eventOutput: decision.skip,
          messageContent: decision.skip,
          durationMs: Date.now() - start,
        };
      }
    }

    const toolMs = this.timeouts.toolCallMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    // Tools don't accept a signal, so a timeout can't cancel the work — it
    // bounds how long we WAIT. The timer is always cleared (no leak); the
    // losing tool promise has a handler attached, so it never rejects loose.
    const exec = executeToolCall(this.registry, {
      id: call.id,
      name: call.name,
      input: call.input,
    });
    const result = await withWaitTimeout(
      exec,
      toolMs,
      () => new AgentTimeoutError("tool", toolMs, runId, usage),
    );
    const durationMs = Date.now() - start;
    const out: ToolExecResult = result.ok
      ? {
          id: call.id,
          name: call.name,
          isError: false,
          eventOutput: result.output,
          messageContent: jsonStringify(result.output),
          durationMs,
        }
      : {
          id: call.id,
          name: call.name,
          isError: true,
          eventOutput: result.error,
          messageContent: result.error,
          durationMs,
        };

    await this.hooks?.afterToolCall?.({
      runId,
      iteration,
      toolCall: call,
      output: out.eventOutput,
      isError: out.isError,
      durationMs,
    });

    return out;
  }

  // ──────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────

  private validateStop(raw: unknown, runId: string, usage: AccumulatedUsage): unknown {
    const stopTool = this.stopTool;
    if (!stopTool) throw new Error("validateStop called without a stop tool");
    try {
      return stopTool.validate(raw);
    } catch (err) {
      throw new AgentStopToolValidationError(
        err instanceof Error ? err.message : String(err),
        runId,
        usage,
        err,
      );
    }
  }

  private checkBoundary(
    external: AbortSignal | undefined,
    runDeadline: RunDeadline | undefined,
    runId: string,
    usage: AccumulatedUsage,
  ): void {
    if (external?.aborted) throw new AgentAbortedError(runId, usage);
    if (runDeadline?.signal.aborted) {
      throw new AgentTimeoutError("run", runDeadline.limitMs, runId, usage);
    }
  }

  private makeRunDeadline(): RunDeadline | undefined {
    const runMs = this.timeouts.runMs;
    if (runMs === undefined) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), runMs);
    return {
      signal: controller.signal,
      limitMs: runMs,
      dispose: () => clearTimeout(timer),
    };
  }

  private accumulate(usage: AccumulatedUsage, step: TokenUsage): void {
    const cacheRead = step.cacheReadTokens ?? 0;
    const cacheWrite = step.cacheCreationTokens ?? 0;
    usage.inputTokens += step.inputTokens;
    usage.outputTokens += step.outputTokens;
    usage.cacheReadTokens += cacheRead;
    usage.cacheCreationTokens += cacheWrite;
    if (this.pricing) usage.costUsd += stepCost(step, this.pricing);
  }

  private truncate(content: string): string {
    const max = this.maxToolResultChars;
    if (content.length <= max) return content;
    return `${content.slice(0, max)}…[truncated: ${max} of ${content.length} chars — refine your query]`;
  }

  private stamp<E extends { type: AgentEvent["type"] }>(
    runId: string,
    event: E,
  ): E & { runId: string; timestamp: number } {
    return { ...event, runId, timestamp: Date.now() };
  }
}

// ────────────────────────────────────────────────────────────────────
// Module-local types + pure helpers
// ────────────────────────────────────────────────────────────────────

type RunDeadline = { signal: AbortSignal; limitMs: number; dispose: () => void };

/** One tool's outcome: `eventOutput` rides the `tool_result` event (full),
 *  `messageContent` is what's fed to the model (pre-truncation). A skipped
 *  tool (hook veto) and an errored tool both flow through this shape. */
type ToolExecResult = {
  id: string;
  name: string;
  isError: boolean;
  eventOutput: unknown;
  messageContent: string;
  durationMs: number;
};

/** Cost of one step (USD). Cache-write = input × 1.25, cache-read = input ×
 *  0.1 — the formula `runReview` has always used. */
function stepCost(usage: TokenUsage, pricing: { input: number; output: number }): number {
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheCreationTokens ?? 0;
  const baseInput = usage.inputTokens - cacheRead - cacheWrite;
  const writeRate = pricing.input * 1.25;
  const readRate = pricing.input * 0.1;
  return (
    (baseInput / 1_000_000) * pricing.input +
    (cacheRead / 1_000_000) * readRate +
    (cacheWrite / 1_000_000) * writeRate +
    (usage.outputTokens / 1_000_000) * pricing.output
  );
}

function summarizeInput(input: string | readonly ModelMessage[]): string {
  if (typeof input === "string") {
    return input.length > INPUT_SUMMARY_MAX ? `${input.slice(0, INPUT_SUMMARY_MAX)}…` : input;
  }
  const lastUser = [...input].reverse().find((m) => m.role === "user");
  const content = lastUser && lastUser.role === "user" ? lastUser.content : "";
  const trimmed =
    content.length > INPUT_SUMMARY_MAX ? `${content.slice(0, INPUT_SUMMARY_MAX)}…` : content;
  return `[${input.length} messages]${trimmed ? ` ${trimmed}` : ""}`;
}

function jsonStringify(value: unknown): string {
  return JSON.stringify(value) ?? "";
}

/**
 * Resolve when `work` settles; reject with `onTimeout()` if `ms` elapses
 * first. The timer is cleared on settle and the losing promise keeps a
 * handler, so nothing leaks and no rejection escapes unhandled.
 */
function withWaitTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Run `fn` over `items` with at most `limit` in flight, preserving result
 * order. Stops pulling new work after the first rejection and rethrows it;
 * already-running calls are awaited (and their late errors swallowed) so no
 * rejection escapes unhandled.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let firstError: unknown;
  let errored = false;

  const worker = async (): Promise<void> => {
    while (!errored) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i] as T, i);
      } catch (err) {
        if (!errored) {
          errored = true;
          firstError = err;
        }
        return;
      }
    }
  };

  const count = Math.min(Math.max(1, limit), items.length || 1);
  await Promise.all(Array.from({ length: count }, () => worker()));
  if (errored) throw firstError;
  return results;
}
