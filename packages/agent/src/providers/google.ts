/**
 * Google (Gemini) adapter for the `ModelProvider` seam.
 *
 * Translates neutral messages/tools ↔ the `@google/genai` SDK. Gemini
 * does not issue tool-call ids, so the adapter synthesizes stable ids on
 * parse and correlates tool results back by tool NAME (not id) when
 * building `functionResponse` parts.
 *
 * Client is injectable; defaults are lazily constructed from an API key.
 */

import type {
  ModelMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ToolCall,
} from "./types.js";
import { ProviderError } from "./types.js";

const PROVIDER = "google";

// ────────────────────────────────────────────────────────────────────
// Minimal structural shape of the @google/genai client we depend on.
// ────────────────────────────────────────────────────────────────────

type GooglePart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type GoogleContent = { role: "user" | "model"; parts: GooglePart[] };

type GoogleGenerateParams = {
  model: string;
  contents: GoogleContent[];
  config?: {
    systemInstruction?: string;
    maxOutputTokens?: number;
    abortSignal?: AbortSignal;
    tools?: Array<{
      functionDeclarations: Array<{ name: string; description: string; parameters: unknown }>;
    }>;
  };
};

type GoogleResponse = {
  text?: string;
  functionCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

export interface GoogleClientLike {
  readonly models: {
    generateContent(params: GoogleGenerateParams): Promise<GoogleResponse>;
  };
}

export type GoogleProviderOptions = {
  readonly client?: GoogleClientLike;
  /** Falls back to `serverEnv.GOOGLE_API_KEY`. */
  readonly apiKey?: string;
  readonly maxTokens?: number;
};

/** Construct a Google/Gemini-backed `ModelProvider`. */
export function google(modelId: string, options: GoogleProviderOptions = {}): ModelProvider {
  let client = options.client ?? null;

  async function getClient(): Promise<GoogleClientLike> {
    if (client) return client;
    const { GoogleGenAI } = await import("@google/genai");
    const apiKey = options.apiKey ?? (await resolveApiKey());
    // why: the SDK client structurally satisfies the narrow surface we
    // call; cast avoids importing the SDK's broad types.
    client = new GoogleGenAI({ apiKey }) as unknown as GoogleClientLike;
    return client;
  }

  return {
    provider: PROVIDER,
    modelId,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const c = await getClient();
      const maxOutputTokens =
        request.maxTokens > 0 ? request.maxTokens : (options.maxTokens ?? undefined);
      const response = await c.models.generateContent({
        model: modelId,
        contents: toGoogleContents(request.messages),
        config: {
          systemInstruction: request.system,
          maxOutputTokens,
          abortSignal: request.signal,
          tools:
            request.tools.length > 0
              ? [
                  {
                    functionDeclarations: request.tools.map((t) => ({
                      name: t.name,
                      description: t.description,
                      parameters: t.inputSchema,
                    })),
                  },
                ]
              : undefined,
        },
      });
      return parseGoogleResponse(response);
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Translation: neutral → Google
// ────────────────────────────────────────────────────────────────────

export function toGoogleContents(messages: readonly ModelMessage[]): GoogleContent[] {
  const out: GoogleContent[] = [];
  // Gemini packs function results into a `user` turn as functionResponse
  // parts. Merge consecutive neutral `tool` messages into one such turn.
  let pendingResponses: GooglePart[] = [];

  const flush = () => {
    if (pendingResponses.length > 0) {
      out.push({ role: "user", parts: pendingResponses });
      pendingResponses = [];
    }
  };

  for (const msg of messages) {
    if (msg.role === "tool") {
      pendingResponses.push({
        functionResponse: {
          name: msg.toolName,
          response: msg.isError ? { error: msg.content } : { result: msg.content },
        },
      });
      continue;
    }
    flush();
    if (msg.role === "user") {
      out.push({ role: "user", parts: [{ text: msg.content }] });
    } else {
      const parts: GooglePart[] = [];
      if (msg.content) parts.push({ text: msg.content });
      for (const call of msg.toolCalls) {
        parts.push({
          functionCall: { name: call.name, args: (call.input ?? {}) as Record<string, unknown> },
        });
      }
      out.push({ role: "model", parts });
    }
  }
  flush();
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Translation: Google → neutral
// ────────────────────────────────────────────────────────────────────

export function parseGoogleResponse(response: GoogleResponse): ModelResponse {
  const calls = response.functionCalls ?? [];
  const toolCalls: ToolCall[] = calls.map((call, i) => ({
    // Gemini issues no id; synthesize a stable one for correlation.
    id: `${call.name}-${i}`,
    name: call.name,
    input: call.args ?? {},
  }));
  return {
    text: response.text ?? "",
    toolCalls,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    },
    stopReason: toolCalls.length > 0 ? "tool_calls" : "stop",
  };
}

async function resolveApiKey(): Promise<string> {
  const { serverEnv } = await import("@acr/shared/env");
  if (!serverEnv.GOOGLE_API_KEY) {
    throw new ProviderError(PROVIDER, "GOOGLE_API_KEY is not set and no client was injected");
  }
  return serverEnv.GOOGLE_API_KEY;
}
