import { routeModel } from "@acr/agent";
import type { ReviewOutput } from "@acr/agent";
import { z } from "zod";

import { checkAccessKey } from "@/lib/access-key";
import { getLangfuse } from "@/lib/langfuse";
import { applyRateLimit } from "@/lib/rate-limit";
import {
  type CacheStatus,
  exactCacheKey,
  lookupExactCache,
  lookupSemanticCache,
} from "@/lib/review-cache";
import { stringifyError } from "@/lib/utils";

const BodySchema = z.object({
  diff: z.string().min(1, "diff must not be empty").max(500_000, "diff exceeds 500 KB limit"),
  model: z.enum(["haiku", "sonnet", "opus", "auto"]).default("auto"),
});

/** Persist a completed review row for a cache hit and return its id. */
async function persistCachedReview(
  diff: string,
  model: string,
  output: ReviewOutput,
  cacheStatus: CacheStatus,
): Promise<string> {
  const { db } = await import("@acr/db/client");
  const { reviews } = await import("@acr/db");
  const [inserted] = await db
    .insert(reviews)
    .values({
      diff,
      model,
      status: "completed",
      output,
      cache_status: cacheStatus,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: "0",
    })
    .returning({ id: reviews.id });

  if (!inserted?.id) {
    throw new Error(`Failed to persist review record for ${cacheStatus} cache hit`);
  }
  return inserted.id;
}

export async function POST(req: Request) {
  // Auth: check ACCESS_KEY if configured
  const denied = checkAccessKey(req);
  if (denied) return denied;

  // Rate limit: 10 requests per IP per minute (sliding window)
  const rl = await applyRateLimit(req);
  if (!rl.success) {
    return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request body", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { diff, model: requestModel } = parsed.data;

  // 1. Model Routing (Phase 5)
  const selectedModel = requestModel === "auto" ? routeModel(diff) : requestModel;
  const redisKey = exactCacheKey(selectedModel, diff);

  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: "review",
    metadata: { model: selectedModel },
  });

  // 2. Check exact-match cache (Redis)
  const exactOutput = await lookupExactCache(redisKey);
  if (exactOutput) {
    try {
      const reviewId = await persistCachedReview(diff, selectedModel, exactOutput, "exact");
      trace?.update({ metadata: { reviewId, cacheStatus: "exact" } });
      await langfuse?.flushAsync();
      return Response.json({ reviewId, status: "completed" }, { status: 200 });
    } catch (err) {
      console.error("[reviews] Failed saving exact cache hit:", { error: stringifyError(err) });
    }
  }

  // 3. Check semantic cache (Postgres pgvector)
  const { output: semanticOutput } = await lookupSemanticCache(diff, selectedModel);
  if (semanticOutput) {
    try {
      const reviewId = await persistCachedReview(diff, selectedModel, semanticOutput, "semantic");
      trace?.update({ metadata: { reviewId, cacheStatus: "semantic" } });
      await langfuse?.flushAsync();
      return Response.json({ reviewId, status: "completed" }, { status: 200 });
    } catch (err) {
      console.error("[reviews] Failed saving semantic cache hit:", { error: stringifyError(err) });
    }
  }

  // 4. Cache Miss: Enqueue review
  const { db } = await import("@acr/db/client");
  const { reviews } = await import("@acr/db");
  const [inserted] = await db
    .insert(reviews)
    .values({ diff, model: selectedModel, status: "pending" })
    .returning({ id: reviews.id });

  if (!inserted) {
    return Response.json({ error: "Failed to persist review" }, { status: 500 });
  }
  const reviewId = inserted.id;

  trace?.update({ metadata: { reviewId, cacheStatus: "miss" } });

  await langfuse?.flushAsync();

  return Response.json({ reviewId, status: "queued" }, { status: 202 });
}
