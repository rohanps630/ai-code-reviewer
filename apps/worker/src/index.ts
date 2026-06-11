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
import { agentEvents, eq, reviews, sql } from "@acr/db";
import { db } from "@acr/db/client";
import { serverEnv } from "@acr/shared/env";

const EVENT_FLUSH_BATCH = 8;

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
      // biome-ignore lint/suspicious/noConsole: worker logging
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

    const embedder = new VoyageClient({
      apiKey: serverEnv.VOYAGE_API_KEY ?? "",
      expectedDimensions: 1024,
    });
    const reranker = serverEnv.COHERE_API_KEY
      ? new CohereReranker({ apiKey: serverEnv.COHERE_API_KEY })
      : undefined;
    const retriever = new HybridRetriever({
      embedder,
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

    // biome-ignore lint/suspicious/noConsole: worker logging
    console.log(`[worker] Completed review ${reviewId}`);
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: worker logging
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
    // biome-ignore lint/suspicious/noConsole: worker logging
    console.error("[worker] Poll error:", err);
  }

  // Sleep before polling again
  setTimeout(poll, 2000);
}

// biome-ignore lint/suspicious/noConsole: worker logging
console.log("[worker] Starting async review queue worker...");
poll();
