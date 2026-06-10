import { z } from "zod";

import { checkAccessKey } from "@/lib/access-key";
import { loadAgentEvents } from "@/lib/agent-events";
import { stringifyError } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  id: z.string().uuid("review id must be a UUID"),
});

/**
 * GET /api/reviews/[id]/events
 *
 * Returns the persisted agent event stream for a review, ordered by `seq`,
 * so a client can replay the run. Each event is the original `ReviewChunk`.
 */
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

  try {
    const events = await loadAgentEvents(parsed.data.id);
    return Response.json({ reviewId: parsed.data.id, count: events.length, events });
  } catch (err) {
    return Response.json({ error: stringifyError(err) }, { status: 500 });
  }
}
