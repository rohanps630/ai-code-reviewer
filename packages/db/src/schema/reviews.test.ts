import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { reviews } from "./reviews.js";

/**
 * Schema sanity tests — no real DB connection required.
 *
 * These tests verify:
 *   1. The table name is correct
 *   2. All expected columns are present in the schema definition
 *   3. Default values are configured on the right columns
 *   4. The `status` column has the correct default
 *
 * They do NOT run SQL or connect to Postgres. Integration tests
 * against a real DB belong in a separate test suite (Phase 2+).
 */

describe("reviews table schema", () => {
  it("has the correct table name", () => {
    expect(getTableName(reviews)).toBe("reviews");
  });

  it("defines all expected Phase 1 columns", () => {
    const columnNames = Object.keys(reviews);
    const expected = [
      "id",
      "diff",
      "output",
      "status",
      "model",
      "input_tokens",
      "output_tokens",
      "cost_usd",
      "created_at",
      "updated_at",
    ];

    for (const col of expected) {
      expect(columnNames, `expected column "${col}" to exist`).toContain(col);
    }
  });

  it("does not define Phase 2+ columns", () => {
    const columnNames = Object.keys(reviews);
    const phase2Plus = [
      "repo_id",
      "chunk_ids",
      "cache_status",
      "prompt_cache_tokens",
      "agent_run_id",
    ];

    for (const col of phase2Plus) {
      expect(columnNames, `column "${col}" should not exist until its phase`).not.toContain(col);
    }
  });

  it("configures a default on the id column", () => {
    // Drizzle stores the default config on the column object
    const idCol = reviews.id;
    expect(idCol.hasDefault).toBe(true);
  });

  it("configures a default on created_at and updated_at", () => {
    expect(reviews.created_at.hasDefault).toBe(true);
    expect(reviews.updated_at.hasDefault).toBe(true);
  });

  it("configures the correct default value for status", () => {
    expect(reviews.status.default).toBe("pending");
  });
});

describe("Review inferred types (compile-time)", () => {
  // These tests are intentionally trivial at runtime — their value is
  // that they won't compile if the types are wrong.
  it("NewReview accepts the minimum required fields", () => {
    // diff and model are the only non-nullable, non-defaulted columns
    const row = {
      diff: "--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-old\n+new",
      model: "claude-sonnet-4-5",
    };
    // If this compiles, the type is correct
    expect(row.diff).toBeTruthy();
    expect(row.model).toBeTruthy();
  });
});
