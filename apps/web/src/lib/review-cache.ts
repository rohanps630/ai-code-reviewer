import crypto from "node:crypto";
import { VoyageClient, toVectorLiteral } from "@acr/agent";
import type { ReviewChunk, ReviewOutput } from "@acr/agent";
import { lt, semanticCache, sql } from "@acr/db";
import { db } from "@acr/db/client";
import { z } from "zod";

import { serverEnv } from "@/lib/env";
import { redis } from "@/lib/redis";
import { SEMANTIC_CACHE_SIMILARITY_THRESHOLD } from "@/lib/review-constants";
import { stringifyError } from "@/lib/utils";

/**
 * Review cache for POST /api/reviews.
 *
 * Two layers, checked in order:
 *  1. Exact cache — Redis keyed by sha256(diff) + model, 7-day TTL.
 *  2. Semantic cache — pgvector cosine search over diff embeddings,
 *     24-hour TTL, hit when distance < SEMANTIC_CACHE_SIMILARITY_THRESHOLD.
 *
 * Cached payloads are revalidated through Zod before reuse — a corrupt
 * or stale-shaped entry is treated as a miss, never returned.
 */

const FindingSchema = z.object({
  category: z.enum(["bug", "perf", "security", "style", "logic"]),
  severity: z.enum(["critical", "major", "minor"]),
  summary: z.string(),
  locationHint: z.string().optional(),
  suggestion: z.string().optional(),
});

const ReviewOutputSchema = z.object({
  summary: z.string(),
  findings: z.array(FindingSchema),
  confidence: z.enum(["high", "medium", "low"]),
});

const EXACT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const SEMANTIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type CacheStatus = "exact" | "semantic";

const CACHE_HIT_MESSAGES: Record<CacheStatus, string> = {
  exact: "Exact cache hit! Retrieving cached review...",
  semantic: "Semantic cache hit (similarity > 95%)! Retrieving cached review...",
};

export function exactCacheKey(model: string, diff: string): string {
  const diffHash = crypto.createHash("sha256").update(diff).digest("hex");
  return `exact_cache:${model}:${diffHash}`;
}

/** Exact-match lookup in Redis. Returns null on miss or invalid shape. */
export async function lookupExactCache(redisKey: string): Promise<ReviewOutput | null> {
  const cached = await redis.get(redisKey);
  if (!cached) return null;
  try {
    const parseResult = ReviewOutputSchema.safeParse(JSON.parse(cached));
    if (!parseResult.success) throw new Error("Cached review has invalid shape");
    return parseResult.data;
  } catch (err) {
    console.error("[reviews] Failed parsing exact cache hit:", { error: stringifyError(err) });
    return null;
  }
}

export type SemanticCacheLookup = {
  /** Diff embedding — kept even on miss so the caller can populate later. */
  embedding: number[] | null;
  output: ReviewOutput | null;
};

/**
 * Semantic lookup via pgvector. Never throws — lookup failures degrade
 * to a cache miss. Also fires a best-effort purge of expired rows.
 */
export async function lookupSemanticCache(
  diff: string,
  model: string,
): Promise<SemanticCacheLookup> {
  let embedding: number[] | null = null;
  let output: ReviewOutput | null = null;

  try {
    if (serverEnv.VOYAGE_API_KEY) {
      const voyageClient = new VoyageClient({
        apiKey: serverEnv.VOYAGE_API_KEY,
        expectedDimensions: 1024,
      });
      embedding = await voyageClient.embedQuery(diff);
      const vectorLiteral = toVectorLiteral(embedding);

      const rows = (await db.execute(sql`
        select
          response,
          embedding <=> ${vectorLiteral}::vector as distance
        from semantic_cache
        where expires_at > now()
          and model = ${model}
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
          output = parseResult.data;
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

  return { embedding, output };
}

/** Populate both cache layers after a successful (uncached) review. */
export async function populateReviewCaches(opts: {
  redisKey: string;
  diff: string;
  model: string;
  output: ReviewOutput;
  embedding: number[] | null;
}): Promise<void> {
  const responseStr = JSON.stringify(opts.output);
  await redis.set(opts.redisKey, responseStr, EXACT_CACHE_TTL_SECONDS).catch(() => false);

  if (opts.embedding) {
    try {
      const expiresAt = new Date(Date.now() + SEMANTIC_CACHE_TTL_MS);
      await db.insert(semanticCache).values({
        diff: opts.diff,
        model: opts.model,
        response: responseStr,
        embedding: opts.embedding,
        expires_at: expiresAt,
      });
    } catch (err) {
      console.error("[reviews] Failed to populate semantic cache:", {
        error: stringifyError(err),
      });
    }
  }
}

/**
 * Build the NDJSON response for a cache hit: one status chunk, a short
 * pause so the client renders the status, then the final output.
 */
export function respondWithCachedReview(
  output: ReviewOutput,
  cacheStatus: CacheStatus,
  reviewId: string,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (chunk: ReviewChunk) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
      };
      emit({ type: "status", message: CACHE_HIT_MESSAGES[cacheStatus] });
      await new Promise((resolve) => setTimeout(resolve, 50));
      emit({ type: "final", output });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Review-Id": reviewId,
    },
  });
}
