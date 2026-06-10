/**
 * Anthropic adapter for the `ModelProvider` seam.
 *
 * Translates neutral messages/tools ↔ the Anthropic Messages API. The
 * underlying client is injectable (DI, like the rest of the package);
 * when omitted it is lazily constructed from an API key so importing this
 * module never forces the SDK to load.
 */

import type {
  ModelMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  StopReason,
  ToolCall,
} from "./types.js";
import { ProviderError } from "./types.js";

const PROVIDER = "anthropic";
const DEFAULT_MAX_TOKENS = 4096;

// ────────────────────────────────────────────────────────────────────
// Minimal structural shape of the Anthropic client we depend on. Kept
// local so this module has no hard type dependency on the SDK surface
// beyond what `generate` actually calls.
// ────────────────────────────────────────────────────────────────────

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: string; [key: string]: unknown };

type AnthropicMessageParam = {
  role: "user" | "assistant";
  content: unknown;
};

type AnthropicCreateParams = {
  model: string;
  max_tokens: number;
  system?: string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  tools?: Array<{ name: string; description: string; input_schema: unknown }>;
  messages: AnthropicMessageParam[];
};

type AnthropicMessage = {
  content: AnthropicContentBlock[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  stop_reason: string | null;
};

export interface AnthropicClientLike {
  readonly messages: {
    create(params: AnthropicCreateParams): Promise<AnthropicMessage>;
  };
}

export type AnthropicProviderOptions = {
  /** Inject a client (real SDK or a test fake). */
  readonly client?: AnthropicClientLike;
  /** Used to lazily build a default client when `client` is omitted.
   *  Falls back to `serverEnv.ANTHROPIC_API_KEY`. */
  readonly apiKey?: string;
  readonly maxTokens?: number;
};

/** Construct an Anthropic-backed `ModelProvider`. */
export function anthropic(modelId: string, options: AnthropicProviderOptions = {}): ModelProvider {
  const maxTokensDefault = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  let client = options.client ?? null;

  async function getClient(): Promise<AnthropicClientLike> {
    if (client) return client;
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const apiKey = options.apiKey ?? (await resolveApiKey());
    // why: the SDK's typed client structurally satisfies the narrow
    // AnthropicClientLike surface we call; cast avoids importing SDK types.
    client = new Anthropic({ apiKey }) as unknown as AnthropicClientLike;
    return client;
  }

  return {
    provider: PROVIDER,
    modelId,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const c = await getClient();
      const message = await c.messages.create({
        model: modelId,
        max_tokens: request.maxTokens || maxTokensDefault,
        system: request.system
          ? [
              {
                type: "text",
                text: request.system,
                cache_control: { type: "ephemeral" },
              },
            ]
          : undefined,
        tools:
          request.tools.length > 0
            ? request.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema,
              }))
            : undefined,
        messages: toAnthropicMessages(request.messages),
      });
      return parseAnthropicMessage(message);
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Translation: neutral → Anthropic
// ────────────────────────────────────────────────────────────────────

export function toAnthropicMessages(messages: readonly ModelMessage[]): AnthropicMessageParam[] {
  const out: AnthropicMessageParam[] = [];
  // Anthropic requires tool results to live in a single user turn as
  // `tool_result` blocks. Consecutive neutral `tool` messages are merged.
  let pendingToolResults: Array<{
    type: "tool_result";
    tool_use_id: string;
    content: string;
    is_error: boolean;
  }> = [];

  const flushToolResults = () => {
    if (pendingToolResults.length > 0) {
      out.push({ role: "user", content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const msg of messages) {
    if (msg.role === "tool") {
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: msg.toolCallId,
        content: msg.content,
        is_error: msg.isError,
      });
      continue;
    }
    flushToolResults();
    if (msg.role === "user") {
      out.push({ role: "user", content: msg.content });
    } else {
      const blocks: AnthropicContentBlock[] = [];
      if (msg.content) blocks.push({ type: "text", text: msg.content });
      for (const call of msg.toolCalls) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      out.push({ role: "assistant", content: blocks });
    }
  }
  flushToolResults();
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Translation: Anthropic → neutral
// ────────────────────────────────────────────────────────────────────

export function parseAnthropicMessage(message: AnthropicMessage): ModelResponse {
  if (!Array.isArray(message.content)) {
    throw new ProviderError(PROVIDER, "response is missing a content array");
  }
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const block of message.content) {
    if (block.type === "text" && typeof block.text === "string") {
      text += block.text;
    } else if (block.type === "tool_use") {
      const b = block as { id: string; name: string; input: unknown };
      toolCalls.push({ id: b.id, name: b.name, input: b.input });
    }
  }
  return {
    text,
    toolCalls,
    usage: {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
      cacheReadTokens: message.usage?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: message.usage?.cache_creation_input_tokens ?? 0,
    },
    stopReason: mapStopReason(message.stop_reason),
  };
}

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "tool_use":
      return "tool_calls";
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "max_tokens";
    default:
      return "other";
  }
}

async function resolveApiKey(): Promise<string> {
  const { serverEnv } = await import("@acr/shared/env");
  if (!serverEnv.ANTHROPIC_API_KEY) {
    throw new ProviderError(PROVIDER, "ANTHROPIC_API_KEY is not set and no client was injected");
  }
  return serverEnv.ANTHROPIC_API_KEY;
}
