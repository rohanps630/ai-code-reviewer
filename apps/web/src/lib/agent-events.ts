import type { ReviewChunk } from "@acr/agent";
import { agentEvents, asc, eq } from "@acr/db";

/**
 * Persistence for the review event stream (`agent_events`).
 *
 * Writes are intentionally best-effort at the call site: a failure to persist
 * must never corrupt the live stream or the `reviews` row. Callers swallow
 * errors (see `review-stream.ts`).
 */

export type SeqChunk = { seq: number; chunk: ReviewChunk };

/** Insert a batch of ordered events for a review. */
export async function insertAgentEvents(reviewId: string, events: SeqChunk[]): Promise<void> {
  if (events.length === 0) return;
  const { db } = await import("@acr/db/client");
  await db.insert(agentEvents).values(
    events.map((e) => ({
      review_id: reviewId,
      seq: e.seq,
      type: e.chunk.type,
      payload: e.chunk,
    })),
  );
}

/** Load a review's persisted event stream, ordered by seq, as ReviewChunks. */
export async function loadAgentEvents(reviewId: string): Promise<ReviewChunk[]> {
  const { db } = await import("@acr/db/client");
  const rows = await db
    .select({ payload: agentEvents.payload })
    .from(agentEvents)
    .where(eq(agentEvents.review_id, reviewId))
    .orderBy(asc(agentEvents.seq));
  // payload is the full ReviewChunk, stored verbatim.
  return rows.map((r) => r.payload as ReviewChunk);
}
