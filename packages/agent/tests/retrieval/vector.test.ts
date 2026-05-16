/**
 * vector.ts — covers the pure helper (toVectorLiteral) + a smoke test
 * of vectorSearch via a stub executor. SQL correctness is not asserted
 * (that's an integration concern); the unit-level guarantee is that:
 *   - empty query vector short-circuits to []
 *   - rows the stub returns flow through rawRowToHit correctly
 */

import { describe, expect, it, vi } from "vitest";
import type { RawChunkRow } from "../../src/retrieval/types.js";
import { toVectorLiteral, vectorSearch } from "../../src/retrieval/vector.js";

describe("toVectorLiteral", () => {
  it("formats a vector as pgvector's bracketed literal", () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
  });
  it("handles empty vectors", () => {
    expect(toVectorLiteral([])).toBe("[]");
  });
  it("preserves negative + scientific-notation values", () => {
    expect(toVectorLiteral([-0.5, 1e-3])).toBe("[-0.5,0.001]");
  });
});

describe("vectorSearch", () => {
  it("short-circuits on empty queryVector without calling the executor", async () => {
    const executor = { execute: vi.fn() };
    const hits = await vectorSearch(executor, {
      queryVector: [],
      limit: 10,
    });
    expect(hits).toEqual([]);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("maps raw rows to ChunkHit objects via rawRowToHit", async () => {
    const row: RawChunkRow = {
      chunk_id: "c1",
      document_id: "d1",
      repo_id: "r1",
      path: "src/foo.ts",
      content: "fn foo()",
      content_with_context: "context: fn foo()",
      start_line: 5,
      end_line: 9,
      symbol_name: "foo",
      symbol_kind: "function",
      score: "0.85",
    };
    const executor = { execute: vi.fn(async () => [row]) };

    const hits = await vectorSearch(executor, {
      queryVector: [0.1, 0.2],
      limit: 5,
    });

    expect(hits).toEqual([
      {
        chunkId: "c1",
        documentId: "d1",
        repoId: "r1",
        path: "src/foo.ts",
        content: "fn foo()",
        contentWithContext: "context: fn foo()",
        startLine: 5,
        endLine: 9,
        symbolName: "foo",
        symbolKind: "function",
        score: 0.85,
      },
    ]);
  });
});
