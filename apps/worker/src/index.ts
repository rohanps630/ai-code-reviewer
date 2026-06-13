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
import { agentEvents, eq, reviews, semanticCache, sql } from "@acr/db";
import { db } from "@acr/db/client";
import {
  EXACT_CACHE_TTL_SECONDS,
  SEMANTIC_CACHE_TTL_MS,
  exactCacheKey,
  summarizeDiffForEmbedding,
} from "@acr/shared/cache";
import { serverEnv } from "@acr/shared/env";
import { redis } from "@acr/shared/redis";

const EVENT_FLUSH_BATCH = 8;

type RetrieverLike = { search: HybridRetriever["search"] };

type WorkerResources = {
  retriever: RetrieverLike;
  codeSource: PostgresCodeSource;
  sandboxFactory: Awaited<ReturnType<typeof defaultE2BFactory>> | undefined;
  /** Embedder for cache population; null when VOYAGE_API_KEY is unset. */
  embedder: VoyageClient | null;
};

// Heavy, stateless clients (embedder, reranker, retriever, code source,
// sandbox factory) are built once and reused across every review. Building
// them per-review (the previous behavior) re-instantiated the Voyage/Cohere
// SDK HTTP clients on every job — wasted setup and no connection reuse. The
// agent loop already shares these via its own singletons; the worker now does
// the same.
let cachedResources: WorkerResources | null = null;

async function ensureWorkerResources(): Promise<WorkerResources> {
  if (cachedResources) return cachedResources;

  const reranker = serverEnv.COHERE_API_KEY
    ? new CohereReranker({ apiKey: serverEnv.COHERE_API_KEY })
    : undefined;

  let retriever: RetrieverLike;
  let embedder: VoyageClient | null = null;
  if (serverEnv.VOYAGE_API_KEY) {
    embedder = new VoyageClient({
      apiKey: serverEnv.VOYAGE_API_KEY,
      expectedDimensions: 1024,
    });
    retriever = new HybridRetriever({
      embedder,
      executor: db as unknown as HybridRetrieverDeps["executor"],
      reranker,
    });
  } else {
    // No embedder key — degrade to empty retrieval rather than constructing a
    // VoyageClient with a blank key that fails at query time.
    console.warn("[worker] VOYAGE_API_KEY not set — retrieval disabled (searches return empty).");
    retriever = { search: async () => [] };
  }

  const sandboxFactory = serverEnv.E2B_API_KEY
    ? await defaultE2BFactory(serverEnv.E2B_API_KEY)
    : undefined;

  cachedResources = {
    retriever,
    // biome-ignore lint/suspicious/noExplicitAny: passing db client
    codeSource: new PostgresCodeSource(db as any),
    sandboxFactory,
    embedder,
  };
  return cachedResources;
}

/**
 * Populate the exact (Redis) and semantic (pgvector) caches after a successful
 * review. This is where caching is actually written — the review API only
 * reads. Best-effort: a cache failure is logged and swallowed, never failing
 * the review. Keyed by the concrete model id (ARCH-4); the semantic vector is
 * built from a stable diff summary (ARCH-6), and the summary (not the raw,
 * possibly-sensitive diff) is what we store alongside it.
 */
async function populateCaches(opts: {
  diff: string;
  modelId: string;
  output: ReviewOutput;
  embedder: VoyageClient | null;
}): Promise<void> {
  const responseStr = JSON.stringify(opts.output);

  await redis
    .set(exactCacheKey(opts.modelId, opts.diff), responseStr, EXACT_CACHE_TTL_SECONDS)
    .catch((err: unknown) => {
      console.error("[worker] Exact cache write failed:", err);
      return false;
    });

  if (!opts.embedder) return;
  try {
    const summary = summarizeDiffForEmbedding(opts.diff);
    const embedding = await opts.embedder.embedQuery(summary);
    await db.insert(semanticCache).values({
      diff: summary,
      model: opts.modelId,
      response: responseStr,
      embedding,
      expires_at: new Date(Date.now() + SEMANTIC_CACHE_TTL_MS),
    });
  } catch (err) {
    console.error("[worker] Semantic cache write failed:", err);
  }
}

async function processReview(reviewId: string, diff: string, selectedModel: string) {
  // biome-ignore lint/suspicious/noConsole: worker logging
  console.log(`[worker] Processing review ${reviewId} with model ${selectedModel}`);

  // Fetch current row and lock it (though we already locked it in the poll loop, this is safe)
  // Actually, we already updated it to 'streaming' in the poll loop.

  let seq = 0;
  const pending: { seq: number; chunk: ReviewChunk }[] = [];

  const flushEvents = async () => {
    if (pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    try {
      await db.insert(agentEvents).values(
        batch.map((e) => ({
          review_id: reviewId,
          seq: e.seq,
          type: e.chunk.type,
          payload: e.chunk,
        })),
      );
    } catch (err) {
      console.error("[worker] Failed to persist agent events:", err);
    }
  };

  const emit = (chunk: ReviewChunk) => {
    pending.push({ seq: seq++, chunk });
  };

  let final: ReviewOutput | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: usage properties
  let usage: any = null;

  try {
    const provider = await resolveProviderForTier(selectedModel, serverEnv);
    const { retriever, codeSource, sandboxFactory, embedder } = await ensureWorkerResources();

    const deps = {
      provider,
      retriever,
      codeSource,
      sandboxFactory,
      // We could add langfuseHooksAdapter here if we want tracing in the worker.
      // For now, we skip tracing in the worker to keep it standalone, or we can copy it later.
    };

    const modelArg = ["haiku", "sonnet", "opus"].includes(selectedModel)
      ? (selectedModel as "haiku" | "sonnet" | "opus")
      : "haiku";

    const gen = runReview({ diff, model: modelArg }, deps);

    for await (const chunk of gen) {
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

    // Populate caches so the next identical/similar review is a hit. Keyed by
    // the concrete model id the review ran on. Best-effort — never blocks or
    // fails the completed review.
    if (final) {
      await populateCaches({ diff, modelId: provider.modelId, output: final, embedder });
    }

    // biome-ignore lint/suspicious/noConsole: worker logging
    console.log(`[worker] Completed review ${reviewId}`);
  } catch (err) {
    console.error(`[worker] Failed review ${reviewId}:`, err);
    await db
      .update(reviews)
      .set({ status: "failed" })
      .where(eq(reviews.id, reviewId))
      .catch(() => undefined);
    emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
    await flushEvents();
  }
}

async function poll() {
  try {
    // Attempt to acquire one pending review using SKIP LOCKED to avoid blocking other workers
    const rows = await db.execute<{ id: string; diff: string; model: string }>(
      sql`
      UPDATE reviews
      SET status = 'streaming', updated_at = NOW()
      WHERE id = (
        SELECT id
        FROM reviews
        WHERE status = 'pending'
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, diff, model
      `,
    );

    if (rows.length > 0 && rows[0]) {
      const { id, diff, model } = rows[0];
      await processReview(id, diff, model);
      // Immediately poll again without waiting if we found a job
      setImmediate(poll);
      return;
    }
  } catch (err) {
    console.error("[worker] Poll error:", err);
  }

  // Sleep before polling again
  setTimeout(poll, 2000);
}

// biome-ignore lint/suspicious/noConsole: worker logging
console.log("[worker] Starting async review queue worker...");
poll();
