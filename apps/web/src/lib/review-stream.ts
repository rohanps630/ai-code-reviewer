import {
  CohereReranker,
  HybridRetriever,
  PostgresCodeSource,
  VoyageClient,
  defaultE2BFactory,
  resolveProviderForTier,
  runReview,
} from "@acr/agent";
import type { HybridRetrieverDeps, ReviewChunk, ReviewOutput } from "@acr/agent";
import { eq, reviews } from "@acr/db";
import { db } from "@acr/db/client";
import type { Langfuse, LangfuseSpanClient } from "langfuse";

import { type SeqChunk, insertAgentEvents } from "@/lib/agent-events";
import { serverEnv } from "@/lib/env";
import { langfuseHooksAdapter } from "@/lib/langfuse-hooks-adapter";
import { populateReviewCaches } from "@/lib/review-cache";
import { stringifyError } from "@/lib/utils";

// Flush persisted events in small batches so a refresh mid-stream can replay
// recent progress without a DB write per chunk.
const EVENT_FLUSH_BATCH = 8;

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

      // Tee the emitted stream into agent_events for later replay. Persistence
      // is best-effort: a failed write logs and is dropped — it must never
      // corrupt the live stream or the review row.
      let seq = 0;
      const pending: SeqChunk[] = [];
      const flushEvents = async () => {
        if (pending.length === 0) return;
        const batch = pending.splice(0, pending.length);
        try {
          await insertAgentEvents(reviewId, batch);
        } catch (err) {
          console.error("[reviews] Failed to persist agent events:", stringifyError(err));
        }
      };

      const emit = (chunk: ReviewChunk) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
        pending.push({ seq: seq++, chunk });
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

        const provider = await resolveProviderForTier(selectedModel, serverEnv);

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
          provider,
          retriever,
          // biome-ignore lint/suspicious/noExplicitAny: passing db client
          codeSource: new PostgresCodeSource(db as any),
          sandboxFactory,
          // Trace model + tool calls via Agent hooks instead of wrapping the
          // provider. Omit when there's no span (Langfuse not configured).
          hooks: span ? langfuseHooksAdapter(span) : undefined,
        };

        const source = await pickSource(input, deps);
        for await (const chunk of source) {
          if (chunk.type === "final") {
            final = chunk.output;
            if (chunk.usage) usage = chunk.usage;
          }
          emit(chunk);
          if (pending.length >= EVENT_FLUSH_BATCH) await flushEvents();
        }
        await flushEvents();

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
        await flushEvents();
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
