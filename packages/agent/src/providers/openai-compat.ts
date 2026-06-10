/**
 * Shared OpenAI-compatible wire format.
 *
 * Both the OpenAI adapter and the Groq adapter speak the same Chat
 * Completions protocol. This module owns the types and translation
 * functions so neither adapter depends on the other — they both depend
 * on this shared layer instead.
 *
 * Nothing here is OpenAI-specific: it is the common subset of the
 * OpenAI-compatible API that Groq, Together, Fireworks, etc. also
 * implement.
 */

import type { ModelMessage, ModelRequest, ModelResponse, StopReason, ToolCall } from "./types.js";
import { ProviderError } from "./types.js";

// ────────────────────────────────────────────────────────────────────
// Wire types (OpenAI Chat Completions shape)
// ────────────────────────────────────────────────────────────────────

export type OAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OAIMessageParam =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type OAICreateParams = {
  model: string;
  max_tokens?: number;
  messages: OAIMessageParam[];
  tools?: Array<{
    type: "function";
    function: { name: string; description: string; parameters: unknown };
  }>;
};

export type OAICompletion = {
  choices: Array<{
    message: { content: string | null; tool_calls?: OAIToolCall[] };
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
};

/** Minimal structural interface for any OpenAI-compatible client. */
export interface OAIClientLike {
  readonly chat: {
    readonly completions: {
      create(params: OAICreateParams, options?: { signal?: AbortSignal }): Promise<OAICompletion>;
    };
  };
}

// ────────────────────────────────────────────────────────────────────
// Translation: neutral → OpenAI-compatible
// ────────────────────────────────────────────────────────────────────

export function toOAIMessages(request: ModelRequest): OAIMessageParam[] {
  const out: OAIMessageParam[] = [];
  if (request.system) out.push({ role: "system", content: request.system });
  for (const msg of request.messages) {
    out.push(neutralToOAI(msg));
  }
  return out;
}

function neutralToOAI(msg: ModelMessage): OAIMessageParam {
  if (msg.role === "user") return { role: "user", content: msg.content };
  if (msg.role === "tool") {
    return { role: "tool", tool_call_id: msg.toolCallId, content: msg.content };
  }
  const toolCalls = msg.toolCalls.map((call) => {
    let serialized: string;
    try {
      serialized = JSON.stringify(call.input ?? {});
    } catch (err) {
      throw new Error(
        `Tool-call input for "${call.name}" is not JSON-serializable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {
      id: call.id,
      type: "function" as const,
      function: { name: call.name, arguments: serialized },
    };
  });
  return {
    role: "assistant",
    content: msg.content || null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

// ────────────────────────────────────────────────────────────────────
// Translation: OpenAI-compatible → neutral
// ────────────────────────────────────────────────────────────────────

export function parseOAICompletion(provider: string, completion: OAICompletion): ModelResponse {
  const choice = completion.choices[0];
  if (!choice) throw new ProviderError(provider, "completion returned no choices");

  const toolCalls: ToolCall[] = [];
  for (const tc of choice.message.tool_calls ?? []) {
    toolCalls.push({
      id: tc.id,
      name: tc.function.name,
      input: parseArgs(provider, tc.function.arguments),
    });
  }
  return {
    text: choice.message.content ?? "",
    toolCalls,
    usage: {
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    },
    stopReason: mapStopReason(choice.finish_reason),
  };
}

function parseArgs(provider: string, raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ProviderError(
      provider,
      `tool-call arguments were not valid JSON: ${raw.slice(0, 80)}`,
    );
  }
}

export function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "tool_calls":
      return "tool_calls";
    case "stop":
      return "stop";
    case "length":
      return "max_tokens";
    default:
      return "other";
  }
}
