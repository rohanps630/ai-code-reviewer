/**
 * Ollama adapter for the `ModelProvider` seam.
 *
 * Ollama exposes an OpenAI-compatible Chat Completions API at
 * http://localhost:11434/v1. No API key is required.
 *
 * Usage:
 *   new Agent({ model: ollama("qwen3.5:latest") })
 *   new Agent({ model: "qwen3.5:latest" })  // auto-routed via registry (colon in ID)
 */

import type { OAIClientLike } from "./openai-compat.js";
import { parseOAICompletion, toOAIMessages } from "./openai-compat.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "./types.js";

const PROVIDER = "ollama";
const DEFAULT_BASE_URL = "http://localhost:11434/v1";

export type OllamaProviderOptions = {
  readonly client?: OAIClientLike;
  /** Defaults to OLLAMA_BASE_URL env var or http://localhost:11434/v1. */
  readonly baseURL?: string;
  readonly maxTokens?: number;
};

/** Construct an Ollama-backed `ModelProvider`. */
export function ollama(modelId: string, options: OllamaProviderOptions = {}): ModelProvider {
  let client: OAIClientLike | null = options.client ?? null;

  async function getClient(): Promise<OAIClientLike> {
    if (client) return client;
    const { default: OpenAI } = await import("openai");
    const baseURL = options.baseURL ?? (await resolveBaseURL());
    // why: Ollama requires no real API key; placeholder satisfies the SDK
    client = new OpenAI({ apiKey: "ollama", baseURL }) as unknown as OAIClientLike;
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

async function resolveBaseURL(): Promise<string> {
  const { serverEnv } = await import("@acr/shared/env");
  return serverEnv.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
}
