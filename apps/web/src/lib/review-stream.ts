import {
  CohereReranker,
  HybridRetriever,
  VoyageClient,
  defaultE2BFactory,
  resolveProviderForTier,
  runReview,
} from "@acr/agent";
import type { HybridRetrieverDeps, ReviewChunk, ReviewOutput } from "@acr/agent";
import { eq, reviews } from "@acr/db";
import { db } from "@acr/db/client";
import type { Langfuse, LangfuseSpanClient } from "langfuse";

import { serverEnv } from "@/lib/env";
import { populateReviewCaches } from "@/lib/review-cache";
import { makeTracedProvider } from "@/lib/traced-provider";
import { stringifyError } from "@/lib/utils";

/**
 * NDJSON stream for a cache-miss review: resolves the model provider,
 * runs the agent loop, persists status transitions + final output on
 * the review row, and populates both cache layers on success.
 */
export function createReviewStream(opts: {
  input: { diff: string; model: "haiku" | "sonnet" | "opus" | "auto" };
  selectedModel: string;
  reviewId: string;
  redisKey: string;
  queryEmbedding: number[] | null;
  span: LangfuseSpanClient | undefined;
  langfuse: Langfuse | null;
}): ReadableStream<Uint8Array> {
  const { input, selectedModel, reviewId, redisKey, queryEmbedding, span, langfuse } = opts;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (chunk: ReviewChunk) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
      };

      let final: ReviewOutput | null = null;
      let usage: {
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
        cacheReadTokens?: number;
        cacheCreationTokens?: number;
      } | null = null;

      try {
        await db.update(reviews).set({ status: "streaming" }).where(eq(reviews.id, reviewId));

        const baseProvider = await resolveProviderForTier(selectedModel, serverEnv);
        const tracedProvider = makeTracedProvider(baseProvider, span);

        const embedder = new VoyageClient({
          apiKey: serverEnv.VOYAGE_API_KEY ?? "",
          expectedDimensions: 1024,
        });
        const reranker = serverEnv.COHERE_API_KEY
          ? new CohereReranker({ apiKey: serverEnv.COHERE_API_KEY })
          : undefined;
        const retriever = new HybridRetriever({
          embedder,
          // why: Drizzle db satisfies the SqlExecutor structural contract
          executor: db as unknown as HybridRetrieverDeps["executor"],
          reranker,
        });

        const sandboxFactory = serverEnv.E2B_API_KEY
          ? await defaultE2BFactory(serverEnv.E2B_API_KEY)
          : undefined;

        const deps = {
          provider: tracedProvider,
          retriever,
          // why: Drizzle db satisfies the SqlExecutorLike structural contract (execute: (q: unknown) => Promise<unknown>)
          executor: db as unknown as { execute: (query: unknown) => Promise<unknown> },
          sandboxFactory,
        };

        const source = await pickSource(input, deps);
        for await (const chunk of source) {
          if (chunk.type === "final") {
            final = chunk.output;
            if (chunk.usage) usage = chunk.usage;
          }
          emit(chunk);
        }

        await db
          .update(reviews)
          .set({
            status: "completed",
            output: final,
            input_tokens: usage ? usage.inputTokens : 0,
            output_tokens: usage ? usage.outputTokens : 0,
            cost_usd: usage ? usage.costUsd.toFixed(6) : "0",
            cache_status: "miss",
            prompt_cache_tokens: usage ? (usage.cacheReadTokens ?? 0) : 0,
          })
          .where(eq(reviews.id, reviewId));

        span?.end();

        // Cache populate on success
        if (final) {
          await populateReviewCaches({
            redisKey,
            diff: input.diff,
            model: selectedModel,
            output: final,
            embedding: queryEmbedding,
          });
        }

        await langfuse?.flushAsync();
      } catch (err) {
        await db
          .update(reviews)
          .set({ status: "failed" })
          .where(eq(reviews.id, reviewId))
          .catch(() => undefined);
        span?.end({ level: "ERROR", statusMessage: stringifyError(err) });
        await langfuse?.flushAsync();
        emit({ type: "error", message: stringifyError(err) });
      } finally {
        controller.close();
      }
    },
  });
}

async function pickSource(
  input: { diff: string; model: "haiku" | "sonnet" | "opus" | "auto" },
  deps?: Parameters<typeof runReview>[1],
): Promise<AsyncIterable<ReviewChunk>> {
  const gen = runReview({ diff: input.diff, model: input.model }, deps);
  const first = await gen.next();
  return prepend(first, gen);
}

async function* prepend(
  first: IteratorResult<ReviewChunk, void>,
  rest: AsyncGenerator<ReviewChunk, void, void>,
): AsyncGenerator<ReviewChunk, void, void> {
  if (!first.done) yield first.value;
  for await (const chunk of rest) yield chunk;
}
