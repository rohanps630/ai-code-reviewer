import { afterEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({ shouldThrow: false }));

vi.mock("@acr/db", () => ({ sql: (s: unknown) => s }));
vi.mock("@acr/db/client", () => ({
  db: {
    execute: async () => {
      if (dbState.shouldThrow) throw new Error("connection refused");
      return [{ "?column?": 1 }];
    },
  },
}));

import { GET } from "./route";

describe("GET /api/health", () => {
  afterEach(() => {
    dbState.shouldThrow = false;
  });

  it("returns 200 ok when the DB is reachable", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", db: "up" });
  });

  it("returns 503 degraded when the DB query fails", async () => {
    dbState.shouldThrow = true;
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "degraded", db: "down" });
  });
});
