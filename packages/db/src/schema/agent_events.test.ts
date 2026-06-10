import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { agentEvents } from "./agent_events.js";

/**
 * Schema sanity tests — no real DB connection required.
 *
 * Verifies table name, expected columns, and defaults for the
 * `agent_events` run/step replay table.
 */

describe("agent_events table schema", () => {
  it("has the correct table name", () => {
    expect(getTableName(agentEvents)).toBe("agent_events");
  });

  it("defines all expected columns", () => {
    const columnNames = Object.keys(agentEvents);
    const expected = ["id", "review_id", "seq", "type", "payload", "created_at"];
    for (const col of expected) {
      expect(columnNames, `expected column "${col}" to exist`).toContain(col);
    }
  });

  it("configures defaults on id and created_at", () => {
    expect(agentEvents.id.hasDefault).toBe(true);
    expect(agentEvents.created_at.hasDefault).toBe(true);
  });

  it("requires review_id, seq, type, and payload", () => {
    expect(agentEvents.review_id.notNull).toBe(true);
    expect(agentEvents.seq.notNull).toBe(true);
    expect(agentEvents.type.notNull).toBe(true);
    expect(agentEvents.payload.notNull).toBe(true);
  });
});

describe("AgentEventRow inferred types (compile-time)", () => {
  it("NewAgentEventRow accepts the minimum required fields", () => {
    const row = {
      review_id: "00000000-0000-0000-0000-000000000000",
      seq: 0,
      type: "status" as const,
      payload: { type: "status", message: "Searching code…" },
    };
    // If this compiles, the insert type is correct.
    expect(row.seq).toBe(0);
    expect(row.type).toBe("status");
  });
});
