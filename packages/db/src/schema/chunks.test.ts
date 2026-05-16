import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { chunks } from "./chunks.js";

describe("chunks table schema", () => {
  it("has the correct table name", () => {
    expect(getTableName(chunks)).toBe("chunks");
  });

  it("defines all expected Phase 2 columns", () => {
    const expected = [
      "id",
      "document_id",
      "repo_id",
      "chunk_index",
      "start_line",
      "end_line",
      "content",
      "content_with_context",
      "symbol_name",
      "symbol_kind",
      "content_hash",
      "embedding",
      "created_at",
      "updated_at",
    ];
    for (const col of expected) {
      expect(Object.keys(chunks), `expected column "${col}"`).toContain(col);
    }
  });

  it("makes embedding + symbol metadata nullable", () => {
    expect(chunks.embedding.notNull).toBe(false);
    expect(chunks.symbol_name.notNull).toBe(false);
    expect(chunks.symbol_kind.notNull).toBe(false);
  });

  it("requires the structural columns", () => {
    expect(chunks.document_id.notNull).toBe(true);
    expect(chunks.repo_id.notNull).toBe(true);
    expect(chunks.chunk_index.notNull).toBe(true);
    expect(chunks.start_line.notNull).toBe(true);
    expect(chunks.end_line.notNull).toBe(true);
    expect(chunks.content.notNull).toBe(true);
    expect(chunks.content_with_context.notNull).toBe(true);
    expect(chunks.content_hash.notNull).toBe(true);
  });

  it("declares the embedding column as a 1024-dim vector", () => {
    // why: voyage-code-3 outputs 1024-dim vectors. Cast through unknown
    // because drizzle's column-type runtime config isn't typed publicly.
    const dim = (chunks.embedding as unknown as { dimensions: number }).dimensions;
    expect(dim).toBe(1024);
  });
});
