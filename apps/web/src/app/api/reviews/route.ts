import crypto from "node:crypto";
import {
  CohereReranker,
  HybridRetriever,
  VoyageClient,
  defaultE2BFactory,
  resolveModel,
  routeModel,
  runReview,
  toVectorLiteral,
} from "@acr/agent";
import type { HybridRetrieverDeps, ModelRequest, ReviewChunk, ReviewOutput } from "@acr/agent";
import { eq, lt, reviews, semanticCache, sql } from "@acr/db";
import { db } from "@acr/db/client";
import { z } from "zod";

import { serverEnv } from "@/lib/env";
import { getLangfuse } from "@/lib/langfuse";
import { redis } from "@/lib/redis";
import { SEMANTIC_CACHE_SIMILARITY_THRESHOLD } from "@/lib/review-constants";

const BodySchema = z.object({
  diff: z.string().min(1, "diff must not be empty"),
  model: z.enum(["haiku", "sonnet", "opus", "auto"]).default("auto"),
});

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

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export async function POST(req: Request) {
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

  // Hash diff + model for exact matching
  const diffHash = sha256(diff);
  const redisKey = `exact_cache:${selectedModel}:${diffHash}`;

  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: "review",
    metadata: { model: selectedModel },
  });

  // Check exact-match cache (Redis)
  const cachedExact = await redis.get(redisKey);
  if (cachedExact) {
    try {
      const parseResult = ReviewOutputSchema.safeParse(JSON.parse(cachedExact));
      if (!parseResult.success) throw new Error("Cached review has invalid shape");
      const cachedOutput = parseResult.data;

      const [inserted] = await db
        .insert(reviews)
        .values({
          diff,
          model: selectedModel,
          status: "completed",
          output: cachedOutput,
          cache_status: "exact",
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: "0",
        })
        .returning({ id: reviews.id });

      if (!inserted?.id) throw new Error("Failed to persist review record for cache hit");
      const reviewId = inserted.id;
      trace?.update({ metadata: { reviewId, cacheStatus: "exact" } });

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          const emit = (chunk: ReviewChunk) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
          };
          emit({ type: "status", message: "Exact cache hit! Retrieving cached review..." });
          await new Promise((resolve) => setTimeout(resolve, 50));
          emit({ type: "final", output: cachedOutput });
          controller.close();
        },
      });

      await langfuse?.flushAsync();

      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Review-Id": reviewId,
        },
      });
    } catch (err) {
      console.error("[reviews] Failed parsing or saving exact cache hit:", {
        error: stringifyError(err),
      });
    }
  }

  // 2. Check semantic cache (Postgres pgvector)
  let queryEmbedding: number[] | null = null;
  let cachedSemanticOutput: ReviewOutput | null = null;

  try {
    if (serverEnv.VOYAGE_API_KEY) {
      const voyageClient = new VoyageClient({
        apiKey: serverEnv.VOYAGE_API_KEY,
        expectedDimensions: 1024,
      });
      queryEmbedding = await voyageClient.embedQuery(diff);
      const vectorLiteral = toVectorLiteral(queryEmbedding);

      const rows = (await db.execute(sql`
        select
          response,
          embedding <=> ${vectorLiteral}::vector as distance
        from semantic_cache
        where expires_at > now()
          and model = ${selectedModel}
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
          cachedSemanticOutput = parseResult.data;
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

  if (cachedSemanticOutput) {
    const semanticOutput = cachedSemanticOutput;
    try {
      const [inserted] = await db
        .insert(reviews)
        .values({
          diff,
          model: selectedModel,
          status: "completed",
          output: semanticOutput,
          cache_status: "semantic",
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: "0",
        })
        .returning({ id: reviews.id });

      if (!inserted?.id) throw new Error("Failed to persist review record for semantic cache hit");
      const reviewId = inserted.id;
      trace?.update({ metadata: { reviewId, cacheStatus: "semantic" } });

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          const emit = (chunk: ReviewChunk) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
          };
          emit({
            type: "status",
            message: "Semantic cache hit (similarity > 95%)! Retrieving cached review...",
          });
          await new Promise((resolve) => setTimeout(resolve, 50));
          emit({ type: "final", output: semanticOutput });
          controller.close();
        },
      });

      await langfuse?.flushAsync();

      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Review-Id": reviewId,
        },
      });
    } catch (err) {
      console.error("[reviews] Failed saving semantic cache hit:", { error: stringifyError(err) });
    }
  }

  // 3. Cache Miss: Run real agent loop
  const [inserted] = await db
    .insert(reviews)
    .values({ diff, model: selectedModel, status: "pending" })
    .returning({ id: reviews.id });

  if (!inserted) {
    return Response.json({ error: "Failed to persist review" }, { status: 500 });
  }
  const reviewId = inserted.id;

  trace?.update({ metadata: { reviewId, cacheStatus: "miss" } });
  const span = trace?.span({ name: "agent-run" });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (chunk: ReviewChunk) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
      };

      let final: ReviewOutput | null = null;
      let usage: {
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
        cacheReadTokens?: number;
        cacheCreationTokens?: number;
      } | null = null;

      try {
        await db.update(reviews).set({ status: "streaming" }).where(eq(reviews.id, reviewId));

        const baseProvider = resolveModel(selectedModel);

        // Langfuse Traced Model Provider
        const tracedProvider = {
          provider: baseProvider.provider,
          modelId: baseProvider.modelId,
          async generate(request: ModelRequest) {
            const generation = span?.generation({
              name: "llm-call",
              model: baseProvider.modelId,
              input: request.messages,
              modelParameters: { maxTokens: request.maxTokens },
            });

            try {
              const res = await baseProvider.generate(request);
              generation?.update({
                output: res.text || res.toolCalls,
                usage: {
                  input: res.usage.inputTokens,
                  output: res.usage.outputTokens,
                },
                metadata: {
                  cacheReadTokens: res.usage.cacheReadTokens,
                  cacheCreationTokens: res.usage.cacheCreationTokens,
                },
              });
              return res;
            } catch (err) {
              generation?.update({
                metadata: { error: stringifyError(err) },
              });
              throw err;
            } finally {
              generation?.end();
            }
          },
        };

        const embedder = new VoyageClient({
          apiKey: serverEnv.VOYAGE_API_KEY ?? "",
          expectedDimensions: 1024,
        });
        const reranker = serverEnv.COHERE_API_KEY
          ? new CohereReranker({ apiKey: serverEnv.COHERE_API_KEY })
          : undefined;
        const retriever = new HybridRetriever({
          embedder,
          // why: Drizzle db satisfies the SqlExecutor structural contract
          executor: db as unknown as HybridRetrieverDeps["executor"],
          reranker,
        });

        const sandboxFactory = serverEnv.E2B_API_KEY
          ? await defaultE2BFactory(serverEnv.E2B_API_KEY)
          : undefined;

        const deps = {
          provider: tracedProvider,
          retriever,
          // why: Drizzle db satisfies the SqlExecutorLike structural contract (execute: (q: unknown) => Promise<unknown>)
          executor: db as unknown as { execute: (query: unknown) => Promise<unknown> },
          sandboxFactory,
        };

        const source = await pickSource(parsed.data, deps);
        for await (const chunk of source) {
          if (chunk.type === "final") {
            final = chunk.output;
            if (chunk.type === "final" && chunk.usage) {
              usage = chunk.usage;
            }
          }
          emit(chunk);
        }

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

        span?.end();

        // 4. Cache populate on success
        if (final) {
          const responseStr = JSON.stringify(final);
          await redis.set(redisKey, responseStr, 7 * 24 * 60 * 60).catch(() => false);

          if (queryEmbedding) {
            try {
              const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
              await db.insert(semanticCache).values({
                diff,
                model: selectedModel,
                response: responseStr,
                embedding: queryEmbedding,
                expires_at: expiresAt,
              });
            } catch (err) {
              console.error("[reviews] Failed to populate semantic cache:", {
                error: stringifyError(err),
              });
            }
          }
        }

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

async function pickSource(
  input: { diff: string; model: "haiku" | "sonnet" | "opus" | "auto" },
  deps?: Parameters<typeof runReview>[1],
): Promise<AsyncIterable<ReviewChunk>> {
  const gen = runReview({ diff: input.diff, model: input.model }, deps);
  const first = await gen.next();
  return prepend(first, gen);
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
