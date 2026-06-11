import { agentEvents, asc, eq, reviews } from "@acr/db";
import { db } from "@acr/db/client";
import { z } from "zod";

import { checkAccessKey } from "@/lib/access-key";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  id: z.string().uuid("review id must be a UUID"),
});

const CACHE_HIT_MESSAGES: Record<string, string> = {
  exact: "Exact cache hit! Retrieving cached review...",
  semantic: "Semantic cache hit (similarity > 95%)! Retrieving cached review...",
};

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = checkAccessKey(req);
  if (denied) return denied;

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
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        let lastSeq = -1;

        while (true) {
          // Fetch the review status
          const [reviewRow] = await db
            .select({
              status: reviews.status,
              cacheStatus: reviews.cache_status,
              output: reviews.output,
            })
            .from(reviews)
            .where(eq(reviews.id, reviewId));

          if (!reviewRow) {
            emit({ type: "error", message: "Review not found" });
            break;
          }

          // Handle Cache Hits
          if (reviewRow.cacheStatus === "exact" || reviewRow.cacheStatus === "semantic") {
            emit({ type: "status", message: CACHE_HIT_MESSAGES[reviewRow.cacheStatus] });
            emit({ type: "final", output: reviewRow.output });
            break;
          }

          // Handle Queue/Streaming (tail agent_events)
          const newEvents = await db
            .select({ seq: agentEvents.seq, payload: agentEvents.payload })
            .from(agentEvents)
            .where(eq(agentEvents.review_id, reviewId))
            .orderBy(asc(agentEvents.seq));

          // Emit any unseen events
          for (const event of newEvents) {
            if (event.seq > lastSeq) {
              emit(event.payload);
              lastSeq = event.seq;
            }
          }

          // Check for termination
          if (reviewRow.status === "completed" || reviewRow.status === "failed") {
            // We wait to ensure all final events are flushed by worker, then we break.
            // A final chunk is always emitted by the worker, so we just terminate.
            break;
          }

          // Poll delay
          await new Promise((resolve) => setTimeout(resolve, 500));
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
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
