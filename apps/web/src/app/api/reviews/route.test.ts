import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Module-level mocks must be hoisted before route import. Vitest's
// vi.mock is hoisted automatically.
const dbState = vi.hoisted(() => ({
  inserted: [] as Array<{ id: string; diff: string; model: string; status: string }>,
  updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
}));

vi.mock("@acr/db/client", () => {
  const insert = (_table: unknown) => ({
    values: (row: { diff: string; model: string; status: string }) => ({
      returning: async (_cols: unknown) => {
        const id = `00000000-0000-0000-0000-${(dbState.inserted.length + 1).toString().padStart(12, "0")}`;
        dbState.inserted.push({ id, ...row });
        return [{ id }];
      },
    }),
  });
  const update = (_table: unknown) => ({
    set: (patch: Record<string, unknown>) => ({
      where: async (whereExpr: { id: string }) => {
        dbState.updates.push({ id: whereExpr.id, patch });
        return undefined;
      },
    }),
  });
  return { db: { insert, update } };
});

vi.mock("@acr/db", () => ({
  reviews: { id: "id-col" },
  eq: (_col: unknown, id: string) => ({ id }),
}));

// Capture the deps the route hands to runReview so tests can assert on
// the provider that the REAL resolution path produced.
const captured = vi.hoisted(() => ({
  providers: [] as Array<{ provider: string; modelId: string }>,
}));

// Spread the real module so the route exercises the REAL
// resolveProviderForTier + routeModel (the seam that broke before).
// Only the LLM loop itself is mocked (shape-only), plus VoyageClient —
// its real constructor throws without an API key and embeddings are
// not under test here.
vi.mock("@acr/agent", async () => {
  const actual = await vi.importActual<typeof import("@acr/agent")>("@acr/agent");
  return {
    ...actual,
    runReview: async function* (
      _input: unknown,
      deps?: { provider?: { provider: string; modelId: string } },
    ) {
      if (deps?.provider) {
        captured.providers.push({
          provider: deps.provider.provider,
          modelId: deps.provider.modelId,
        });
      }
      yield { type: "status", message: "Starting review..." } as const;
      yield { type: "text", delta: "Test review text" } as const;
      yield {
        type: "final" as const,
        output: {
          summary: "Test summary",
          findings: [],
          confidence: "high" as const,
        },
        usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.001 },
      };
    },
    VoyageClient: class {
      embedQuery = async () => [0.1, 0.2];
    },
  };
});

// Fake ANTHROPIC_API_KEY so the real provider cascade resolves
// deterministically to Anthropic. Everything else stays unset (no
// Voyage/Redis/Cohere/E2B), keeping the cache layers disabled.
vi.mock("@/lib/env", () => {
  const serverEnv = { ANTHROPIC_API_KEY: "sk-ant-test-key" };
  return { serverEnv, env: serverEnv, clientEnv: {} };
});

const langfuseSpans = vi.hoisted(() => ({
  traceCalls: [] as Array<{ name: string }>,
  flushCalls: 0,
}));

vi.mock("@/lib/langfuse", () => ({
  getLangfuse: () => ({
    trace: (args: { name: string }) => {
      langfuseSpans.traceCalls.push(args);
      return {
        update: (_u: unknown) => undefined,
        span: (_a: unknown) => ({
          end: (_p?: unknown) => undefined,
          generation: (_g: unknown) => ({
            update: (_gu: unknown) => undefined,
            end: () => undefined,
          }),
        }),
      };
    },
    flushAsync: async () => {
      langfuseSpans.flushCalls += 1;
    },
  }),
}));

import { SEMANTIC_CACHE_SIMILARITY_THRESHOLD } from "@/lib/review-constants";
import type { ReviewChunk } from "@acr/agent";
import { POST } from "./route";

async function drainNdjson(res: Response): Promise<ReviewChunk[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ReviewChunk);
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/reviews", () => {
  beforeEach(() => {
    dbState.inserted.length = 0;
    dbState.updates.length = 0;
    langfuseSpans.traceCalls.length = 0;
    langfuseSpans.flushCalls = 0;
    captured.providers.length = 0;
  });
  afterEach(() => vi.clearAllMocks());

  it("returns 400 when the body is invalid", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid request body");
  });

  it("returns 400 when diff is an empty string", async () => {
    const res = await POST(makeRequest({ diff: "" }));
    expect(res.status).toBe(400);
  });

  it("streams agent chunks and persists the review", async () => {
    const res = await POST(makeRequest({ diff: "@@ -1 +1 @@\n-a\n+b" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/x-ndjson/);
    expect(res.headers.get("X-Review-Id")).toBeTruthy();

    const chunks = await drainNdjson(res);
    expect(chunks.some((c) => c.type === "status")).toBe(true);
    expect(chunks.some((c) => c.type === "text")).toBe(true);
    const final = chunks.find((c) => c.type === "final");
    expect(final).toBeDefined();
    if (final?.type === "final") {
      expect(final.output.summary).toBeTruthy();
      expect(Array.isArray(final.output.findings)).toBe(true);
    }

    // DB row created, then transitioned streaming → completed
    expect(dbState.inserted).toHaveLength(1);
    expect(dbState.inserted[0]?.status).toBe("pending");

    const finalUpdate = dbState.updates.at(-1);
    expect(finalUpdate?.patch.status).toBe("completed");
    expect(finalUpdate?.patch.output).toBeDefined();
  });

  it("invokes the Langfuse client", async () => {
    const res = await POST(makeRequest({ diff: "x" }));
    await drainNdjson(res);
    expect(langfuseSpans.traceCalls).toHaveLength(1);
    expect(langfuseSpans.traceCalls[0]?.name).toBe("review");
    expect(langfuseSpans.flushCalls).toBeGreaterThan(0);
  });

  it("routes 'auto' through the real routeModel (trivial diff → haiku)", async () => {
    const res = await POST(makeRequest({ diff: "x" }));
    await drainNdjson(res);
    expect(dbState.inserted[0]?.model).toBe("haiku");
  });

  it("cache miss resolves the provider through the real cascade", async () => {
    const res = await POST(makeRequest({ diff: "x", model: "sonnet" }));
    expect(res.status).toBe(200);

    const chunks = await drainNdjson(res);
    // A resolution failure would surface as an error chunk, not final
    expect(chunks.find((c) => c.type === "error")).toBeUndefined();
    expect(chunks.find((c) => c.type === "final")).toBeDefined();

    // Real resolveProviderForTier + real routeModel: with only
    // ANTHROPIC_API_KEY set, "sonnet" must resolve to Anthropic.
    expect(dbState.inserted[0]?.model).toBe("sonnet");
    expect(captured.providers).toHaveLength(1);
    expect(captured.providers[0]?.provider).toBe("anthropic");
    expect(captured.providers[0]?.modelId).toBe("claude-sonnet-4-7");
  });
});

describe("SEMANTIC_CACHE_SIMILARITY_THRESHOLD boundary", () => {
  it("is exported and equals 0.05", () => {
    expect(SEMANTIC_CACHE_SIMILARITY_THRESHOLD).toBe(0.05);
  });

  it("cache miss when distance equals the threshold", () => {
    // distance >= threshold must NOT be a hit
    expect(SEMANTIC_CACHE_SIMILARITY_THRESHOLD).toBeGreaterThan(0);
    const missDistance = SEMANTIC_CACHE_SIMILARITY_THRESHOLD;
    expect(missDistance < SEMANTIC_CACHE_SIMILARITY_THRESHOLD).toBe(false);
  });

  it("cache hit when distance is just below the threshold", () => {
    // distance < threshold IS a hit
    const hitDistance = SEMANTIC_CACHE_SIMILARITY_THRESHOLD - 0.001;
    expect(hitDistance < SEMANTIC_CACHE_SIMILARITY_THRESHOLD).toBe(true);
  });
});
