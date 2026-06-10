/**
 * Agent runtime — events, accumulated usage, error taxonomy, and the
 * hook/stop-tool/timeout config types (ADR-004).
 *
 * Split out of agent.ts so the runtime file stays focused on the loop.
 * The `Agent` class re-exports the public names from its barrel.
 */

import type { ModelMessage, ModelResponse, TokenUsage, ToolCall } from "./providers/index.js";
import type { JsonSchemaObject } from "./tools/index.js";

// ────────────────────────────────────────────────────────────────────
// Usage
// ────────────────────────────────────────────────────────────────────

/** Running totals across every model call in a run. */
export type AccumulatedUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
};

export function zeroUsage(): AccumulatedUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
  };
}

// ────────────────────────────────────────────────────────────────────
// Event stream
// ────────────────────────────────────────────────────────────────────

/** Why the loop stopped. `answer` is only legal without a stop tool;
 *  `stop_tool` means the model called the configured stop tool. */
export type AgentStopReason = "answer" | "stop_tool";

type EventBase = {
  /** Stable per-run id (`crypto.randomUUID()`). */
  readonly runId: string;
  /** `Date.now()` when the event was emitted. */
  readonly timestamp: number;
};

/**
 * Typed event union emitted by `Agent.stream()`. Every event carries
 * `runId` + `timestamp`. `run()` is a thin drain of this stream.
 */
export type AgentEvent =
  | (EventBase & {
      readonly type: "run_start";
      readonly inputSummary: string;
      readonly modelId: string;
      readonly maxIterations: number;
    })
  | (EventBase & { readonly type: "model_call_start"; readonly iteration: number })
  | (EventBase & {
      readonly type: "model_response";
      readonly iteration: number;
      readonly text: string;
      readonly toolCallCount: number;
      readonly usage: TokenUsage;
    })
  | (EventBase & { readonly type: "tool_call"; readonly name: string; readonly input: unknown })
  | (EventBase & {
      readonly type: "tool_result";
      readonly name: string;
      readonly output: unknown;
      readonly isError: boolean;
      readonly durationMs: number;
    })
  | (EventBase & {
      readonly type: "final";
      readonly text: string;
      readonly stopToolInput?: unknown;
      readonly usage: AccumulatedUsage;
      readonly iterations: number;
      readonly stopReason: AgentStopReason;
      /** Full transcript, so a caller can continue the conversation by
       *  appending a new user message and passing it back to `stream`. */
      readonly messages: readonly ModelMessage[];
    })
  | (EventBase & {
      readonly type: "run_error";
      readonly errorName: string;
      readonly message: string;
    });

// ────────────────────────────────────────────────────────────────────
// Error taxonomy
// ────────────────────────────────────────────────────────────────────

/** Base for every error the runtime raises. Carries the run id and the
 *  usage accumulated up to the moment of failure (provider errors are not
 *  wrapped — `ProviderError` passes through untouched). */
export abstract class AgentError extends Error {
  readonly runId: string;
  /** Partial usage at throw time. */
  readonly usage: AccumulatedUsage;
  constructor(message: string, runId: string, usage: AccumulatedUsage) {
    super(message);
    this.name = new.target.name;
    this.runId = runId;
    this.usage = usage;
  }
}

/** Loop hit `maxIterations` without terminating. Re-parented from
 *  ADR-003 (name preserved for callers that `instanceof` it). */
export class AgentMaxIterationsError extends AgentError {
  readonly iterations: number;
  constructor(iterations: number, runId: string, usage: AccumulatedUsage) {
    super(`Agent did not produce a final answer within ${iterations} iterations`, runId, usage);
    this.iterations = iterations;
  }
}

/** Accumulated cost reached the configured `costCapUsd`. */
export class AgentCostCapError extends AgentError {
  readonly costUsd: number;
  readonly capUsd: number;
  readonly iteration: number;
  constructor(
    costUsd: number,
    capUsd: number,
    iteration: number,
    runId: string,
    usage: AccumulatedUsage,
  ) {
    super(
      `Agent cost cap exceeded: $${costUsd.toFixed(4)} >= $${capUsd.toFixed(2)} after iteration ${iteration}`,
      runId,
      usage,
    );
    this.costUsd = costUsd;
    this.capUsd = capUsd;
    this.iteration = iteration;
  }
}

/** An external `AbortSignal` fired. */
export class AgentAbortedError extends AgentError {
  constructor(runId: string, usage: AccumulatedUsage) {
    super("Agent run aborted by caller", runId, usage);
  }
}

export type TimeoutBudget = "model" | "tool" | "run";

/** A configured timeout budget elapsed. `budget` names which one. */
export class AgentTimeoutError extends AgentError {
  readonly budget: TimeoutBudget;
  constructor(budget: TimeoutBudget, limitMs: number, runId: string, usage: AccumulatedUsage) {
    super(`Agent ${budget} timeout exceeded (${limitMs}ms)`, runId, usage);
    this.budget = budget;
  }
}

/** A stop tool is configured but the model ended its turn without calling
 *  it (and without any other tool) — it failed to terminate as required. */
export class AgentNoStopToolError extends AgentError {
  readonly stopToolName: string;
  constructor(stopToolName: string, runId: string, usage: AccumulatedUsage) {
    super(
      `Agent ended its turn without calling the stop tool '${stopToolName}' or any other tool`,
      runId,
      usage,
    );
    this.stopToolName = stopToolName;
  }
}

/** `stopTool.validate` rejected the model's structured output. The
 *  validator's original error is preserved in `cause`. */
export class AgentStopToolValidationError extends AgentError {
  constructor(message: string, runId: string, usage: AccumulatedUsage, cause?: unknown) {
    super(message, runId, usage);
    // why: Error's `cause` option isn't threaded through the AgentError
    // chain; set it directly so callers can recover the underlying error.
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

// ────────────────────────────────────────────────────────────────────
// Hooks
// ────────────────────────────────────────────────────────────────────

export type BeforeModelCallContext = {
  readonly runId: string;
  readonly iteration: number;
  readonly modelId: string;
  readonly messages: readonly ModelMessage[];
};

export type AfterModelCallContext = {
  readonly runId: string;
  readonly iteration: number;
  readonly response: ModelResponse;
  readonly usage: AccumulatedUsage;
};

export type BeforeToolCallContext = {
  readonly runId: string;
  readonly iteration: number;
  readonly toolCall: ToolCall;
};

export type AfterToolCallContext = {
  readonly runId: string;
  readonly iteration: number;
  readonly toolCall: ToolCall;
  readonly output: unknown;
  readonly isError: boolean;
  readonly durationMs: number;
};

/** Returned by `beforeToolCall` to skip execution; the string is fed back
 *  to the model verbatim as that tool's result. */
export type SkipToolDecision = { readonly skip: string };

/**
 * Lifecycle hooks. Hook errors **fail the run** — they are guardrails, not
 * best-effort logging. `beforeToolCall` can veto a tool by returning
 * `{ skip }`: the tool is not executed and the string becomes its result.
 * That skip path is the human-approval / policy seam.
 */
export type AgentHooks = {
  readonly beforeModelCall?: (ctx: BeforeModelCallContext) => void | Promise<void>;
  readonly afterModelCall?: (ctx: AfterModelCallContext) => void | Promise<void>;
  readonly beforeToolCall?: (
    ctx: BeforeToolCallContext,
  ) => void | SkipToolDecision | Promise<void> | Promise<SkipToolDecision>;
  readonly afterToolCall?: (ctx: AfterToolCallContext) => void | Promise<void>;
};

// ────────────────────────────────────────────────────────────────────
// Stop tool + timeouts + run options
// ────────────────────────────────────────────────────────────────────

/**
 * Structured-termination tool. Appended to the tool specs but **never
 * executed**: when the model calls it, `validate` runs on the raw input
 * and the loop ends with a `final` event carrying the validated value.
 * With a stop tool configured, a no-tool-call turn throws.
 */
export type StopToolConfig = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaObject;
  /** Validate (and optionally transform) the model's raw input. Throw to
   *  reject — the throw surfaces as `AgentStopToolValidationError`. */
  readonly validate: (raw: unknown) => unknown;
};

export type AgentTimeouts = {
  /** Per model call. Default 120_000. */
  readonly modelCallMs?: number;
  /** Per tool call. Default 120_000. */
  readonly toolCallMs?: number;
  /** Whole run. Default unlimited. */
  readonly runMs?: number;
};

export type AgentRunOptions = {
  /** Cancels the run end-to-end; checked at every loop boundary and
   *  threaded into the model call. */
  readonly signal?: AbortSignal;
};
