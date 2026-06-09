/**
 * OpenAI adapter for the `ModelProvider` seam.
 *
 * Translates neutral messages/tools ↔ the OpenAI Chat Completions API.
 * Client is injectable; defaults are lazily constructed from an API key.
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

const PROVIDER = "openai";

// ────────────────────────────────────────────────────────────────────
// Minimal structural shape of the OpenAI client we depend on.
// ────────────────────────────────────────────────────────────────────

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAIMessageParam =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type OpenAICreateParams = {
  model: string;
  max_tokens?: number;
  messages: OpenAIMessageParam[];
  tools?: Array<{
    type: "function";
    function: { name: string; description: string; parameters: unknown };
  }>;
};

type OpenAICompletion = {
  choices: Array<{
    message: { content: string | null; tool_calls?: OpenAIToolCall[] };
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
};

export interface OpenAIClientLike {
  readonly chat: {
    readonly completions: {
      create(params: OpenAICreateParams): Promise<OpenAICompletion>;
    };
  };
}

export type OpenAIProviderOptions = {
  readonly client?: OpenAIClientLike;
  /** Falls back to `serverEnv.OPENAI_API_KEY`. */
  readonly apiKey?: string;
  readonly maxTokens?: number;
};

/** Construct an OpenAI-backed `ModelProvider`. */
export function openai(modelId: string, options: OpenAIProviderOptions = {}): ModelProvider {
  let client = options.client ?? null;

  async function getClient(): Promise<OpenAIClientLike> {
    if (client) return client;
    const { default: OpenAI } = await import("openai");
    const apiKey = options.apiKey ?? (await resolveApiKey());
    // why: the SDK client structurally satisfies the narrow surface we
    // call; cast avoids importing the SDK's broad types.
    client = new OpenAI({ apiKey }) as unknown as OpenAIClientLike;
    return client;
  }

  return {
    provider: PROVIDER,
    modelId,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const c = await getClient();
      const completion = await c.chat.completions.create({
        model: modelId,
        max_tokens: request.maxTokens > 0 ? request.maxTokens : (options.maxTokens ?? undefined),
        messages: toOpenAIMessages(request),
        tools:
          request.tools.length > 0
            ? request.tools.map((t) => ({
                type: "function" as const,
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.inputSchema,
                },
              }))
            : undefined,
      });
      return parseOpenAICompletion(completion);
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Translation: neutral → OpenAI
// ────────────────────────────────────────────────────────────────────

export function toOpenAIMessages(request: ModelRequest): OpenAIMessageParam[] {
  const out: OpenAIMessageParam[] = [];
  if (request.system) out.push({ role: "system", content: request.system });
  for (const msg of request.messages) {
    out.push(neutralToOpenAI(msg));
  }
  return out;
}

function neutralToOpenAI(msg: ModelMessage): OpenAIMessageParam {
  if (msg.role === "user") {
    return { role: "user", content: msg.content };
  }
  if (msg.role === "tool") {
    return { role: "tool", tool_call_id: msg.toolCallId, content: msg.content };
  }
  const toolCalls = msg.toolCalls.map((call) => ({
    id: call.id,
    type: "function" as const,
    function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
  }));
  return {
    role: "assistant",
    content: msg.content || null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

// ────────────────────────────────────────────────────────────────────
// Translation: OpenAI → neutral
// ────────────────────────────────────────────────────────────────────

export function parseOpenAICompletion(completion: OpenAICompletion): ModelResponse {
  const choice = completion.choices[0];
  if (!choice) {
    throw new ProviderError(PROVIDER, "completion returned no choices");
  }
  const toolCalls: ToolCall[] = [];
  for (const tc of choice.message.tool_calls ?? []) {
    toolCalls.push({ id: tc.id, name: tc.function.name, input: parseArgs(tc.function.arguments) });
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

function parseArgs(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ProviderError(
      PROVIDER,
      `tool-call arguments were not valid JSON: ${raw.slice(0, 80)}`,
    );
  }
}

function mapStopReason(reason: string | null): StopReason {
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

async function resolveApiKey(): Promise<string> {
  const { serverEnv } = await import("@acr/shared/env");
  if (!serverEnv.OPENAI_API_KEY) {
    throw new ProviderError(PROVIDER, "OPENAI_API_KEY is not set and no client was injected");
  }
  return serverEnv.OPENAI_API_KEY;
}
