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

const langfuseSpans = vi.hoisted(() => ({
  traceCalls: [] as Array<{ name: string }>,
  flushCalls: 0,
}));

vi.mock("@/lib/langfuse", () => ({
  getLangfuse: () => ({
    trace: (args: { name: string }) => {
      langfuseSpans.traceCalls.push(args);
      return {
        span: (_a: unknown) => ({ end: (_p?: unknown) => undefined }),
      };
    },
    flushAsync: async () => {
      langfuseSpans.flushCalls += 1;
    },
  }),
}));

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

  it("streams placeholder chunks and persists the review", async () => {
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
      expect(final.output.summary).toMatch(/placeholder/i);
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

  it("defaults the model to sonnet", async () => {
    const res = await POST(makeRequest({ diff: "x" }));
    await drainNdjson(res);
    expect(dbState.inserted[0]?.model).toBe("sonnet");
  });
});
