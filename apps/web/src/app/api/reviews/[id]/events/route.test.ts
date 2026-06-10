import { describe, expect, it, vi } from "vitest";

// Mock the DB client so loadAgentEvents returns controlled rows.
const dbState = vi.hoisted(() => ({ rows: [] as Array<{ payload: unknown }> }));

vi.mock("@acr/db/client", () => {
  const select = () => ({
    from: () => ({
      where: () => ({
        orderBy: async () => dbState.rows,
      }),
    }),
  });
  return { db: { select } };
});

vi.mock("@acr/db", () => ({
  agentEvents: { payload: "payload", review_id: "review_id", seq: "seq" },
  asc: (c: unknown) => c,
  eq: (_c: unknown, v: unknown) => ({ v }),
}));

import { GET } from "./route";

const makeCtx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/reviews/[id]/events", () => {
  it("400s on a non-uuid id", async () => {
    const res = await GET(new Request("http://test/api/reviews/x/events"), makeCtx("not-a-uuid"));
    expect(res.status).toBe(400);
  });

  it("returns the ordered event stream for a valid id", async () => {
    dbState.rows = [
      { payload: { type: "status", message: "Searching…" } },
      { payload: { type: "tool_call", name: "search_code", input: { query: "auth" } } },
      { payload: { type: "final", output: { summary: "s", findings: [], confidence: "high" } } },
    ];
    const id = "11111111-1111-1111-1111-111111111111";

    const res = await GET(new Request(`http://test/api/reviews/${id}/events`), makeCtx(id));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      reviewId: string;
      count: number;
      events: Array<{ type: string }>;
    };
    expect(body.reviewId).toBe(id);
    expect(body.count).toBe(3);
    expect(body.events[0]).toEqual({ type: "status", message: "Searching…" });
    expect(body.events[2]?.type).toBe("final");
  });

  it("returns an empty stream when there are no events", async () => {
    dbState.rows = [];
    const id = "22222222-2222-2222-2222-222222222222";
    const res = await GET(new Request(`http://test/api/reviews/${id}/events`), makeCtx(id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; events: unknown[] };
    expect(body.count).toBe(0);
    expect(body.events).toEqual([]);
  });
});
