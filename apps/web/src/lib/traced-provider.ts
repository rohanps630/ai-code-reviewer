import type { ModelProvider, ModelRequest } from "@acr/agent";
import type { LangfuseSpanClient } from "langfuse";

import { stringifyError } from "@/lib/utils";

/**
 * Wrap a ModelProvider so every generate() call is recorded as a
 * Langfuse generation under the given span (token usage, cache stats,
 * and errors). Pass-through when no span is available.
 */
export function makeTracedProvider(
  baseProvider: ModelProvider,
  span: LangfuseSpanClient | undefined,
): ModelProvider {
  return {
    provider: baseProvider.provider,
    modelId: baseProvider.modelId,
    async generate(request: ModelRequest) {
      const generation = span?.generation({
        name: "llm-call",
        model: baseProvider.modelId,
        input: request.messages,
        modelParameters: { maxTokens: request.maxTokens },
      });

      try {
        const res = await baseProvider.generate(request);
        generation?.update({
          output: res.text || res.toolCalls,
          usage: {
            input: res.usage.inputTokens,
            output: res.usage.outputTokens,
          },
          metadata: {
            cacheReadTokens: res.usage.cacheReadTokens,
            cacheCreationTokens: res.usage.cacheCreationTokens,
          },
        });
        return res;
      } catch (err) {
        generation?.update({
          metadata: { error: stringifyError(err) },
        });
        throw err;
      } finally {
        generation?.end();
      }
    },
  };
}
