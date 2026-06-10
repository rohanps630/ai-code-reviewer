/**
 * OpenAI adapter for the `ModelProvider` seam.
 *
 * Translates neutral messages/tools ↔ the OpenAI Chat Completions API.
 * Wire-format types and translation live in `openai-compat.ts`; this
 * file owns only the OpenAI-specific client construction and key lookup.
 */

import type { OAIClientLike } from "./openai-compat.js";
import { parseOAICompletion, toOAIMessages } from "./openai-compat.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "./types.js";
import { ProviderError } from "./types.js";

const PROVIDER = "openai";

/** Alias so external callers keep their existing import. */
export type { OAIClientLike as OpenAIClientLike };

export type OpenAIProviderOptions = {
  readonly client?: OAIClientLike;
  /** Falls back to `serverEnv.OPENAI_API_KEY`. */
  readonly apiKey?: string;
  readonly maxTokens?: number;
};

/** Construct an OpenAI-backed `ModelProvider`. */
export function openai(modelId: string, options: OpenAIProviderOptions = {}): ModelProvider {
  let client = options.client ?? null;

  async function getClient(): Promise<OAIClientLike> {
    if (client) return client;
    const { default: OpenAI } = await import("openai");
    const apiKey = options.apiKey ?? (await resolveApiKey());
    // why: the SDK client structurally satisfies the narrow surface we call
    client = new OpenAI({ apiKey }) as unknown as OAIClientLike;
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
  if (!serverEnv.OPENAI_API_KEY) {
    throw new ProviderError(PROVIDER, "OPENAI_API_KEY is not set and no client was injected");
  }
  return serverEnv.OPENAI_API_KEY;
}
