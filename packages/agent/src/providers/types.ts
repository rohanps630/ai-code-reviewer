/**
 * Provider seam — the normalized contract every LLM adapter implements.
 *
 * This is the layer that makes the `Agent` class model-agnostic. A
 * `ModelProvider` performs ONE inference step: given provider-neutral
 * messages + tool specs, it returns the assistant's text, any tool calls
 * it wants to make, token usage, and why it stopped.
 *
 * Each concrete provider (Anthropic, OpenAI, Google) owns a small adapter
 * that translates these neutral types to/from its SDK's wire format. The
 * `Agent` loop never sees an SDK type — it only speaks `ModelMessage` /
 * `ToolSpec` / `ModelResponse`.
 *
 * See docs/adr/003-pluggable-agent-providers.md.
 */

import type { JsonSchemaObject } from "../tools/index.js";

// ────────────────────────────────────────────────────────────────────
// Messages
// ────────────────────────────────────────────────────────────────────

/** A tool call the model wants to make. `id` is the provider's
 *  correlation id (Anthropic `tool_use_id`, OpenAI `tool_call.id`); for
 *  providers that don't issue ids (Gemini) the adapter synthesizes one. */
export type ToolCall = {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
};

/**
 * Provider-neutral conversation turn.
 *   - user      → the human/input text
 *   - assistant → the model's text plus any tool calls it made
 *   - tool      → the result of executing one tool call, fed back in
 *
 * `tool` messages carry BOTH `toolCallId` (for providers that correlate by
 * id) and `toolName` (for providers like Gemini that correlate by name),
 * so every adapter has what it needs without a second lookup.
 */
export type ModelMessage =
  | { readonly role: "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string;
      readonly toolCalls: readonly ToolCall[];
    }
  | {
      readonly role: "tool";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly content: string;
      readonly isError: boolean;
    };

// ────────────────────────────────────────────────────────────────────
// Tools + request/response
// ────────────────────────────────────────────────────────────────────

/** What the model is told about a tool. Provider-neutral: `inputSchema`
 *  is plain JSON Schema, which every provider accepts (Anthropic
 *  `input_schema`, OpenAI `function.parameters`, Gemini
 *  `functionDeclarations.parameters`). */
export type ToolSpec = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaObject;
};

export type ModelRequest = {
  readonly system?: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolSpec[];
  readonly maxTokens: number;
};

export type TokenUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheCreationTokens?: number;
};

/** Normalized stop reason. Providers use different vocabularies; adapters
 *  collapse them to this set. `tool_calls` means the model wants to call
 *  tools before continuing. */
export type StopReason = "tool_calls" | "stop" | "max_tokens" | "other";

export type ModelResponse = {
  /** Assistant text for this turn. May be empty when the model only
   *  emitted tool calls. */
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  readonly usage: TokenUsage;
  readonly stopReason: StopReason;
};

// ────────────────────────────────────────────────────────────────────
// The provider interface
// ────────────────────────────────────────────────────────────────────

/**
 * A pluggable model backend. Implement this to add a new provider; the
 * `Agent` class works with any conforming object.
 */
export interface ModelProvider {
  /** Stable provider id, e.g. "anthropic" | "openai" | "google". */
  readonly provider: string;
  /** Concrete model id passed to the provider, e.g. "claude-sonnet-4-7". */
  readonly modelId: string;
  /** Run one inference step. Must not mutate `request`. */
  generate(request: ModelRequest): Promise<ModelResponse>;
}

/** Raised by adapters when a provider response can't be normalized
 *  (missing content, unparsable tool args, empty choices, etc.). */
export class ProviderError extends Error {
  public readonly provider: string;
  constructor(provider: string, message: string) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
    this.provider = provider;
  }
}
