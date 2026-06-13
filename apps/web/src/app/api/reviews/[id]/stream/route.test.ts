import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_ID = "00000000-0000-0000-0000-000000000abc";

// ── Mocks ────────────────────────────────────────────────────────────────

const auth = vi.hoisted(() => ({ denied: null as Response | null }));
vi.mock("@/lib/access-key", () => ({
  ACCESS_KEY_COOKIE: "acr_key",
  checkAccessKey: () => auth.denied,
}));

const rl = vi.hoisted(() => ({ success: true }));
vi.mock("@/lib/rate-limit", () => ({
  applyRateLimit: async () => ({ success: rl.success, limit: 10, remaining: 0, reset: 0 }),
}));

// Structured operator markers so tests can introspect the WHERE clause.
vi.mock("@acr/db", () => ({
  reviews: {
    id: "reviews.id",
    status: "reviews.status",
    cache_status: "reviews.cache_status",
    output: "reviews.output",
    created_at: "reviews.created_at",
  },
  agentEvents: { seq: "agent.seq", payload: "agent.payload", review_id: "agent.review_id" },
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  gt: (col: unknown, val: unknown) => ({ op: "gt", col, val }),
  asc: (c: unknown) => ({ op: "asc", c }),
}));

type ReviewRow = {
  status: string;
  cacheStatus: string;
  output: unknown;
  createdAt: Date;
};

const dbState = vi.hoisted(() => ({
  reviewRow: null as ReviewRow | null,
  events: [] as Array<{ seq: number; payload: unknown }>,
  eventWhere: undefined as unknown,
  updates: [] as Array<{ patch: Record<string, unknown>; where: unknown }>,
}));

vi.mock("@acr/db/client", () => {
  function selectBuilder() {
    let table: unknown;
    const builder: Record<string, unknown> = {
      from(t: unknown) {
        table = t;
        return builder;
      },
      where(cond: unknown) {
        // The events query targets agentEvents; capture its predicate.
        if (table && (table as { seq?: string }).seq === "agent.seq") {
          dbState.eventWhere = cond;
        }
        return builder;
      },
      orderBy() {
        return builder;
      },
      // biome-ignore lint/suspicious/noThenProperty: drizzle query builders are thenable; this mock mimics that so `await db.select()...` resolves rows.
      then(resolve: (rows: unknown[]) => unknown, reject: (e: unknown) => unknown) {
        const isEvents = (table as { seq?: string })?.seq === "agent.seq";
        const rows = isEvents
          ? dbState.events
          : dbState.reviewRow
            ? [
                {
                  status: dbState.reviewRow.status,
                  cacheStatus: dbState.reviewRow.cacheStatus,
                  output: dbState.reviewRow.output,
                  createdAt: dbState.reviewRow.createdAt,
                },
              ]
            : [];
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return builder;
  }
  return {
    db: {
      select: () => selectBuilder(),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: async (where: unknown) => {
            dbState.updates.push({ patch, where });
          },
        }),
      }),
    },
  };
});

import { GET } from "./route";

function call(id = VALID_ID): Promise<Response> {
  return GET(new Request(`http://localhost/api/reviews/${id}/stream`), {
    params: Promise.resolve({ id }),
  });
}

async function collect(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("GET /api/reviews/[id]/stream", () => {
  beforeEach(() => {
    auth.denied = null;
    rl.success = true;
    dbState.reviewRow = null;
    dbState.events = [];
    dbState.eventWhere = undefined;
    dbState.updates.length = 0;
  });
  afterEach(() => vi.clearAllMocks());

  it("returns the auth response when access is denied (SEC-5 cookie/header guard)", async () => {
    auth.denied = Response.json({ error: "Unauthorized" }, { status: 401 });
    const res = await call();
    expect(res.status).toBe(401);
  });

  it("returns 429 when the connection is rate-limited (SEC-2)", async () => {
    rl.success = false;
    const res = await call();
    expect(res.status).toBe(429);
  });

  it("rejects a non-UUID id with 400", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("emits status + final for a valid cache hit", async () => {
    dbState.reviewRow = {
      status: "completed",
      cacheStatus: "exact",
      output: { summary: "ok", findings: [], confidence: "high" },
      createdAt: new Date(),
    };
    const chunks = await collect(await call());
    expect(chunks.at(0)?.type).toBe("status");
    expect(chunks.at(-1)).toMatchObject({ type: "final" });
  });

  it("emits an error (not a crash) when cached output is malformed (SEC-7)", async () => {
    dbState.reviewRow = {
      status: "completed",
      cacheStatus: "semantic",
      output: { summary: 123, findings: "nope" }, // corrupt row
      createdAt: new Date(),
    };
    const chunks = await collect(await call());
    expect(chunks.at(-1)).toMatchObject({ type: "error" });
  });

  it("tails events with a `seq > lastSeq` predicate (BUG-1)", async () => {
    dbState.reviewRow = {
      status: "completed",
      cacheStatus: "miss",
      output: null,
      createdAt: new Date(),
    };
    dbState.events = [{ seq: 0, payload: { type: "status", message: "go" } }];
    await collect(await call());
    // The events WHERE must AND together eq(review_id) and gt(seq).
    const where = dbState.eventWhere as { op: string; args: Array<{ op: string }> };
    expect(where?.op).toBe("and");
    expect(where.args.some((a) => a.op === "gt")).toBe(true);
  });

  it("self-heals a stuck review to failed past the deadline (BUG-2)", async () => {
    dbState.reviewRow = {
      status: "streaming",
      cacheStatus: "miss",
      output: null,
      createdAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago — well past deadline
    };
    const chunks = await collect(await call());
    expect(dbState.updates).toHaveLength(1);
    expect(dbState.updates[0]?.patch.status).toBe("failed");
    expect(chunks.at(-1)).toMatchObject({ type: "error" });
  });

  it("emits a not-found error for a missing review", async () => {
    dbState.reviewRow = null;
    const chunks = await collect(await call());
    expect(chunks.at(-1)).toMatchObject({ type: "error", message: "Review not found" });
  });
});
