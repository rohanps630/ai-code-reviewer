import { runReview } from "@acr/agent";
import type { ReviewChunk, ReviewOutput } from "@acr/agent";
import { eq, reviews } from "@acr/db";
import { db } from "@acr/db/client";
import { z } from "zod";

import { getLangfuse } from "@/lib/langfuse";
import { placeholderReview } from "./placeholder";

const BodySchema = z.object({
  diff: z.string().min(1, "diff must not be empty"),
  model: z.enum(["haiku", "sonnet", "opus"]).default("sonnet"),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request body", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { diff, model } = parsed.data;

  const [inserted] = await db
    .insert(reviews)
    .values({ diff, model, status: "pending" })
    .returning({ id: reviews.id });

  if (!inserted) {
    return Response.json({ error: "Failed to persist review" }, { status: 500 });
  }
  const reviewId = inserted.id;

  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: "review",
    metadata: { reviewId, model },
  });
  const span = trace?.span({ name: "placeholder-stream" });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (chunk: ReviewChunk) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
      };

      let final: ReviewOutput | null = null;
      try {
        await db.update(reviews).set({ status: "streaming" }).where(eq(reviews.id, reviewId));

        const source = await pickSource(parsed.data);
        for await (const chunk of source) {
          if (chunk.type === "final") final = chunk.output;
          emit(chunk);
        }

        await db
          .update(reviews)
          .set({
            status: "completed",
            output: final,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: "0",
          })
          .where(eq(reviews.id, reviewId));

        span?.end();
        await langfuse?.flushAsync();
      } catch (err) {
        await db
          .update(reviews)
          .set({ status: "failed" })
          .where(eq(reviews.id, reviewId))
          .catch(() => undefined);
        span?.end({ level: "ERROR", statusMessage: stringifyError(err) });
        await langfuse?.flushAsync();
        emit({ type: "status", message: `Error: ${stringifyError(err)}` });
      } finally {
        controller.close();
      }
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

async function pickSource(input: {
  diff: string;
  model: "haiku" | "sonnet" | "opus";
}): Promise<AsyncIterable<ReviewChunk>> {
  // Phase 3.4 landed the real agent loop but we don't fire it from the
  // route yet — the dark-code pattern from Phase 2.7. To cut over,
  // drop this try/catch and return `runReview({...})` directly.
  // Until then: try runReview, fall back to the placeholder on any
  // error (missing API key, network, etc.) so dev requests don't 500.
  try {
    const gen = runReview({ diff: input.diff, model: input.model });
    // Force the generator to start so any setup error (missing env,
    // failed dep wiring) surfaces here rather than mid-stream.
    const first = await gen.next();
    return prepend(first, gen);
  } catch {
    return placeholderReview();
  }
}

async function* prepend(
  first: IteratorResult<ReviewChunk, void>,
  rest: AsyncGenerator<ReviewChunk, void, void>,
): AsyncGenerator<ReviewChunk, void, void> {
  if (!first.done) yield first.value;
  for await (const chunk of rest) yield chunk;
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Unknown error";
}
