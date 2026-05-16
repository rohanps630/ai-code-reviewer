import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { documents } from "./documents.js";

describe("documents table schema", () => {
  it("has the correct table name", () => {
    expect(getTableName(documents)).toBe("documents");
  });

  it("defines all expected Phase 2 columns", () => {
    const expected = [
      "id",
      "repo_id",
      "path",
      "language",
      "content_hash",
      "size_bytes",
      "last_modified",
      "indexed_at",
      "created_at",
      "updated_at",
    ];
    for (const col of expected) {
      expect(Object.keys(documents), `expected column "${col}"`).toContain(col);
    }
  });

  it("requires repo_id, path, content_hash, size_bytes", () => {
    expect(documents.repo_id.notNull).toBe(true);
    expect(documents.path.notNull).toBe(true);
    expect(documents.content_hash.notNull).toBe(true);
    expect(documents.size_bytes.notNull).toBe(true);
  });

  it("makes language + last_modified nullable", () => {
    expect(documents.language.notNull).toBe(false);
    expect(documents.last_modified.notNull).toBe(false);
  });

  it("configures defaults on id, indexed_at, created_at, updated_at", () => {
    expect(documents.id.hasDefault).toBe(true);
    expect(documents.indexed_at.hasDefault).toBe(true);
    expect(documents.created_at.hasDefault).toBe(true);
    expect(documents.updated_at.hasDefault).toBe(true);
  });
});
