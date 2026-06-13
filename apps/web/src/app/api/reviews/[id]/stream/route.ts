import { agentEvents, and, asc, eq, gt, reviews } from "@acr/db";
import { db } from "@acr/db/client";
import { z } from "zod";

import { checkAccessKey } from "@/lib/access-key";
import { applyRateLimit } from "@/lib/rate-limit";
import { CACHE_HIT_MESSAGES } from "@/lib/review-constants";
import { parseReviewOutput } from "@/lib/review-output";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  id: z.string().uuid("review id must be a UUID"),
});

/** How often we poll Postgres for new events / status changes. */
const POLL_INTERVAL_MS = 500;

/**
 * Hard ceiling on a review's lifetime. A single SSE connection never polls
 * past this, and a review still non-terminal past it is treated as a dead
 * worker (crash, OOM, redeploy) and self-healed to `failed` — otherwise the
 * row stays `streaming` forever and every client polling it loops indefinitely.
 * A cost-capped, 10-iteration review completes in well under this.
 */
const STREAM_DEADLINE_MS = 10 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET /api/reviews/[id]/stream
 *
 * Tails a review to the client as newline-delimited JSON (NDJSON, one
 * `ReviewChunk` per line — see contracts/event-stream.md). The browser client
 * consumes this with `fetch` + a `ReadableStream` reader so it can send the
 * access-key cookie and control reconnection (EventSource can do neither).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = checkAccessKey(req);
  if (denied) return denied;

  // Rate-limit connection establishment. Without this the endpoint accepts
  // unlimited concurrent infinite-polling connections per client.
  const rl = await applyRateLimit(req);
  if (!rl.success) {
    return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const parsed = ParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid review id", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const reviewId = parsed.data.id;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (data: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(data)}\n`));
      };

      const startedAt = Date.now();

      try {
        let lastSeq = -1;

        while (!req.signal.aborted) {
          const [reviewRow] = await db
            .select({
              status: reviews.status,
              cacheStatus: reviews.cache_status,
              output: reviews.output,
              createdAt: reviews.created_at,
            })
            .from(reviews)
            .where(eq(reviews.id, reviewId));

          if (!reviewRow) {
            emit({ type: "error", message: "Review not found" });
            break;
          }

          // Cache hit — emit the (validated) stored output and finish.
          if (reviewRow.cacheStatus === "exact" || reviewRow.cacheStatus === "semantic") {
            emit({ type: "status", message: CACHE_HIT_MESSAGES[reviewRow.cacheStatus] });
            const output = parseReviewOutput(reviewRow.output);
            if (output) {
              emit({ type: "final", output });
            } else {
              emit({ type: "error", message: "Cached review output is malformed" });
            }
            break;
          }

          // Tail only events we haven't seen yet (was: fetch-all-then-filter,
          // which re-read the entire history every 500ms — O(n) per tick).
          const newEvents = await db
            .select({ seq: agentEvents.seq, payload: agentEvents.payload })
            .from(agentEvents)
            .where(and(eq(agentEvents.review_id, reviewId), gt(agentEvents.seq, lastSeq)))
            .orderBy(asc(agentEvents.seq));

          for (const event of newEvents) {
            emit(event.payload);
            lastSeq = event.seq;
          }

          if (reviewRow.status === "completed" || reviewRow.status === "failed") {
            break;
          }

          // Self-heal a dead worker: a review still running past the deadline
          // is stuck. Flip it to `failed` so this and every other connection
          // can terminate, and tell the client.
          const age = Date.now() - new Date(reviewRow.createdAt).getTime();
          if (age > STREAM_DEADLINE_MS) {
            await db
              .update(reviews)
              .set({ status: "failed" })
              .where(and(eq(reviews.id, reviewId), eq(reviews.status, reviewRow.status)));
            emit({
              type: "error",
              message: "Review timed out — the worker did not complete it in time.",
            });
            break;
          }

          await sleep(POLL_INTERVAL_MS);

          // Defensive: never let one connection outlive the deadline even if
          // the row's clock and ours disagree.
          if (Date.now() - startedAt > STREAM_DEADLINE_MS) {
            emit({ type: "error", message: "Stream timed out." });
            break;
          }
        }
      } catch (err) {
        console.error("[reviews] Stream error:", err);
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
