import { resolveModelIdForEnv, routeModel } from "@acr/agent";
import type { ReviewOutput } from "@acr/agent";
import { after } from "next/server";
import { z } from "zod";

import { checkAccessKey, principalId } from "@/lib/access-key";
import { serverEnv } from "@/lib/env";
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

/**
 * Drain Langfuse *after* the response is sent. Awaiting `flushAsync()` inline
 * blocks the user's submission on the observability backend — if Langfuse is
 * slow or down, every review degrades. `after()` runs the flush post-response
 * while the platform keeps the function alive, so tracing never sits on the
 * request's critical path.
 */
function flushLangfuseAfterResponse(langfuse: ReturnType<typeof getLangfuse>): void {
  if (!langfuse) return;
  after(async () => {
    try {
      await langfuse.flushAsync();
    } catch (err) {
      console.error("[reviews] Langfuse flush failed:", { error: stringifyError(err) });
    }
  });
}

/** Persist a completed review row for a cache hit and return its id. */
async function persistCachedReview(
  diff: string,
  model: string,
  output: ReviewOutput,
  cacheStatus: CacheStatus,
  ownerId: string | null,
): Promise<string> {
  const { db } = await import("@acr/db/client");
  const { reviews } = await import("@acr/db");
  const [inserted] = await db
    .insert(reviews)
    .values({
      diff,
      model,
      owner_id: ownerId,
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

  // Tenancy seam: stamp the authenticated principal (null in open mode).
  const ownerId = principalId(req);

  // 1. Model Routing (Phase 5)
  const selectedModel = requestModel === "auto" ? routeModel(diff) : requestModel;
  // Cache by the concrete model id the review will run on (ARCH-4), so a tier
  // repoint (e.g. sonnet → a newer model) doesn't serve stale outputs. The
  // worker derives the same id from the same tier + env when it populates.
  const cacheModelId = resolveModelIdForEnv(selectedModel, serverEnv);
  const redisKey = exactCacheKey(cacheModelId, diff);

  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: "review",
    metadata: { model: selectedModel },
  });

  // 2. Check exact-match cache (Redis)
  const exactOutput = await lookupExactCache(redisKey);
  if (exactOutput) {
    try {
      const reviewId = await persistCachedReview(
        diff,
        selectedModel,
        exactOutput,
        "exact",
        ownerId,
      );
      trace?.update({ metadata: { reviewId, cacheStatus: "exact" } });
      flushLangfuseAfterResponse(langfuse);
      return Response.json({ reviewId, status: "completed" }, { status: 200 });
    } catch (err) {
      console.error("[reviews] Failed saving exact cache hit:", { error: stringifyError(err) });
    }
  }

  // 3. Check semantic cache (Postgres pgvector)
  const { output: semanticOutput } = await lookupSemanticCache(diff, cacheModelId);
  if (semanticOutput) {
    try {
      const reviewId = await persistCachedReview(
        diff,
        selectedModel,
        semanticOutput,
        "semantic",
        ownerId,
      );
      trace?.update({ metadata: { reviewId, cacheStatus: "semantic" } });
      flushLangfuseAfterResponse(langfuse);
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
    .values({ diff, model: selectedModel, owner_id: ownerId, status: "pending" })
    .returning({ id: reviews.id });

  if (!inserted) {
    return Response.json({ error: "Failed to persist review" }, { status: 500 });
  }
  const reviewId = inserted.id;

  trace?.update({ metadata: { reviewId, cacheStatus: "miss" } });

  flushLangfuseAfterResponse(langfuse);

  return Response.json({ reviewId, status: "queued" }, { status: 202 });
}
