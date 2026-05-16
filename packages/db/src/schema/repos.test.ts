import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { repos } from "./repos.js";

/**
 * Schema sanity tests — no DB connection required.
 * Asserts table name, expected columns, and key defaults.
 */

describe("repos table schema", () => {
  it("has the correct table name", () => {
    expect(getTableName(repos)).toBe("repos");
  });

  it("defines all expected Phase 2 columns", () => {
    const expected = [
      "id",
      "url",
      "owner",
      "name",
      "default_branch",
      "last_indexed_at",
      "last_indexed_commit",
      "status",
      "created_at",
      "updated_at",
    ];
    for (const col of expected) {
      expect(Object.keys(repos), `expected column "${col}"`).toContain(col);
    }
  });

  it("defaults default_branch to 'main' and status to 'pending'", () => {
    expect(repos.default_branch.default).toBe("main");
    expect(repos.status.default).toBe("pending");
  });

  it("configures defaults on id, created_at, updated_at", () => {
    expect(repos.id.hasDefault).toBe(true);
    expect(repos.created_at.hasDefault).toBe(true);
    expect(repos.updated_at.hasDefault).toBe(true);
  });

  it("allows last_indexed_at and last_indexed_commit to be nullable", () => {
    expect(repos.last_indexed_at.notNull).toBe(false);
    expect(repos.last_indexed_commit.notNull).toBe(false);
  });
});
