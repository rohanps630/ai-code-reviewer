/**
 * Groq adapter for the `ModelProvider` seam.
 *
 * Groq exposes an OpenAI-compatible Chat Completions API. This adapter
 * builds directly on the shared `openai-compat` layer — it does NOT
 * import the OpenAI adapter, so OpenAI-specific changes can never
 * silently affect Groq.
 *
 * Usage:
 *   new Agent({ model: groq("llama-3.1-8b-instant") })
 *   new Agent({ model: "llama-3.1-8b-instant" })  // auto-routed via registry
 */

import type { OAIClientLike } from "./openai-compat.js";
import { parseOAICompletion, toOAIMessages } from "./openai-compat.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "./types.js";

const PROVIDER = "groq";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export type GroqProviderOptions = {
  readonly client?: OAIClientLike;
  /** Falls back to `serverEnv.GROQ_API_KEY`. */
  readonly apiKey?: string;
  readonly maxTokens?: number;
};

/** Construct a Groq-backed `ModelProvider`. */
export function groq(modelId: string, options: GroqProviderOptions = {}): ModelProvider {
  let client: OAIClientLike | null = options.client ?? null;

  async function getClient(): Promise<OAIClientLike> {
    if (client) return client;
    const { default: OpenAI } = await import("openai");
    const apiKey = options.apiKey ?? (await resolveApiKey());
    // why: Groq is OpenAI-compatible — same SDK, different baseURL
    client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL }) as unknown as OAIClientLike;
    return client;
  }

  return {
    provider: PROVIDER,
    modelId,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const c = await getClient();
      const completion = await c.chat.completions.create(
        {
          model: modelId,
          max_tokens: request.maxTokens > 0 ? request.maxTokens : (options.maxTokens ?? undefined),
          messages: toOAIMessages(request),
          tools:
            request.tools.length > 0
              ? request.tools.map((t) => ({
                  type: "function" as const,
                  function: { name: t.name, description: t.description, parameters: t.inputSchema },
                }))
              : undefined,
        },
        request.signal ? { signal: request.signal } : undefined,
      );
      return parseOAICompletion(PROVIDER, completion);
    },
  };
}

async function resolveApiKey(): Promise<string> {
  const { serverEnv } = await import("@acr/shared/env");
  if (!serverEnv.GROQ_API_KEY) {
    throw new Error("[groq] GROQ_API_KEY is not set and no client was injected");
  }
  return serverEnv.GROQ_API_KEY;
}
