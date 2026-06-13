import { VoyageClient, toVectorLiteral } from "@acr/agent";
import type { ReviewOutput } from "@acr/agent";
import { lt, semanticCache, sql } from "@acr/db";
import { db } from "@acr/db/client";
import { exactCacheKey, summarizeDiffForEmbedding } from "@acr/shared/cache";

import { serverEnv } from "@/lib/env";
import { redis } from "@/lib/redis";
import { SEMANTIC_CACHE_SIMILARITY_THRESHOLD } from "@/lib/review-constants";
import { ReviewOutputSchema } from "@/lib/review-output";
import { stringifyError } from "@/lib/utils";

/**
 * Review cache **read** path for POST /api/reviews.
 *
 * Two layers, checked in order:
 *  1. Exact cache — Redis keyed by sha256(diff) + concrete model id, 7-day TTL.
 *  2. Semantic cache — pgvector cosine search over diff-*summary* embeddings,
 *     24-hour TTL, hit when distance < SEMANTIC_CACHE_SIMILARITY_THRESHOLD.
 *
 * Cached payloads are revalidated through Zod before reuse — a corrupt or
 * stale-shaped entry is treated as a miss, never returned. The **write** path
 * lives in the worker (apps/worker), which is where reviews actually complete;
 * both sides share `exactCacheKey` + `summarizeDiffForEmbedding` so reads line
 * up with writes.
 */

export type CacheStatus = "exact" | "semantic";

// Re-exported so the route keeps a single import site for cache helpers.
export { exactCacheKey };

/** Exact-match lookup in Redis. Returns null on miss or invalid shape. */
export async function lookupExactCache(redisKey: string): Promise<ReviewOutput | null> {
  const cached = await redis.get(redisKey);
  if (!cached) return null;
  try {
    const parseResult = ReviewOutputSchema.safeParse(JSON.parse(cached));
    if (!parseResult.success) throw new Error("Cached review has invalid shape");
    return parseResult.data as ReviewOutput;
  } catch (err) {
    console.error("[reviews] Failed parsing exact cache hit:", { error: stringifyError(err) });
    return null;
  }
}

export type SemanticCacheLookup = {
  output: ReviewOutput | null;
};

/**
 * Semantic lookup via pgvector. Never throws — lookup failures degrade to a
 * cache miss. Embeds a stable diff *summary* (not the raw diff, which would
 * overflow the embedder's context). Also fires a best-effort purge of expired
 * rows.
 *
 * @param diff - The raw diff being reviewed.
 * @param modelId - The concrete model id the review would run on (cache key).
 */
export async function lookupSemanticCache(
  diff: string,
  modelId: string,
): Promise<SemanticCacheLookup> {
  let output: ReviewOutput | null = null;

  try {
    if (serverEnv.VOYAGE_API_KEY) {
      const voyageClient = new VoyageClient({
        apiKey: serverEnv.VOYAGE_API_KEY,
        expectedDimensions: 1024,
      });
      const embedding = await voyageClient.embedQuery(summarizeDiffForEmbedding(diff));
      const vectorLiteral = toVectorLiteral(embedding);

      const rows = (await db.execute(sql`
        select
          response,
          embedding <=> ${vectorLiteral}::vector as distance
        from semantic_cache
        where expires_at > now()
          and model = ${modelId}
        order by embedding <=> ${vectorLiteral}::vector
        limit 1
      `)) as unknown as Array<{ response: string; distance: number }>;

      // Fire-and-forget: purge expired rows while we have a DB connection.
      // The Promise is intentionally not awaited — expiry cleanup is best-effort.
      db.delete(semanticCache)
        .where(lt(semanticCache.expires_at, new Date()))
        .catch(() => undefined);

      const hit = rows[0];
      if (hit && Number(hit.distance) < SEMANTIC_CACHE_SIMILARITY_THRESHOLD) {
        const parseResult = ReviewOutputSchema.safeParse(JSON.parse(hit.response));
        if (parseResult.success) {
          output = parseResult.data as ReviewOutput;
        } else {
          console.error("[reviews] Semantic cache hit has invalid shape — ignoring:", {
            issues: parseResult.error.flatten(),
          });
        }
      }
    }
  } catch (err) {
    console.error("[reviews] Semantic cache lookup failed:", { error: stringifyError(err) });
  }

  return { output };
}
