/**
 * Reciprocal rank fusion — pure function tests.
 * No I/O, no mocks needed; just construct ranked lists and verify ordering.
 */

import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "../../src/retrieval/rrf.js";
import type { ChunkHit } from "../../src/retrieval/types.js";

function hit(id: string, score = 0.5): ChunkHit {
  return {
    chunkId: id,
    documentId: `doc-${id}`,
    repoId: "repo-1",
    path: `src/${id}.ts`,
    content: `chunk ${id}`,
    contentWithContext: `chunk ${id}`,
    startLine: 1,
    endLine: 10,
    symbolName: id,
    symbolKind: "function",
    score,
  };
}

describe("reciprocalRankFusion", () => {
  it("returns an empty list when both lanes are empty", () => {
    expect(reciprocalRankFusion([], [])).toEqual([]);
  });

  it("orders by RRF score (higher is better)", () => {
    // Hit 'a' is best in both lanes; 'b' is second in both. RRF should
    // pick 'a' first.
    const bm25 = [hit("a"), hit("b"), hit("c")];
    const vec = [hit("a"), hit("b"), hit("c")];
    const fused = reciprocalRankFusion(bm25, vec);
    expect(fused.map((r) => r.chunkId)).toEqual(["a", "b", "c"]);
  });

  it("merges duplicate chunkIds across lanes by summing contributions", () => {
    const bm25 = [hit("a"), hit("b")];
    const vec = [hit("b"), hit("a")];
    const fused = reciprocalRankFusion(bm25, vec, { k: 60 });

    // a: rank 1 in bm25, rank 2 in vec  → 1/61 + 1/62
    // b: rank 2 in bm25, rank 1 in vec  → 1/62 + 1/61
    // They're equal; both get included.
    expect(fused).toHaveLength(2);
    expect(fused.map((r) => r.chunkId).sort()).toEqual(["a", "b"]);
  });

  it("records lane-local rank breadcrumbs", () => {
    const bm25 = [hit("a"), hit("b")];
    const vec = [hit("b")];
    const fused = reciprocalRankFusion(bm25, vec);

    const byId = new Map(fused.map((r) => [r.chunkId, r]));
    expect(byId.get("a")?.bm25Rank).toBe(1);
    expect(byId.get("a")?.vectorRank).toBe(null);
    expect(byId.get("b")?.bm25Rank).toBe(2);
    expect(byId.get("b")?.vectorRank).toBe(1);
  });

  it("a chunk hit in both lanes outranks one hit in only one lane", () => {
    // 'shared' is rank 2 in both lanes; 'bm25-only' is rank 1 in bm25 alone.
    // RRF formula: shared = 1/62 + 1/62 ≈ 0.0323; bm25-only = 1/61 ≈ 0.0164.
    const bm25 = [hit("bm25-only"), hit("shared")];
    const vec = [hit("vec-only"), hit("shared")];
    const fused = reciprocalRankFusion(bm25, vec);
    expect(fused[0]?.chunkId).toBe("shared");
  });

  it("honors the limit option", () => {
    const bm25 = ["a", "b", "c", "d", "e"].map((id) => hit(id));
    const vec = ["a", "b", "c", "d", "e"].map((id) => hit(id));
    const fused = reciprocalRankFusion(bm25, vec, { limit: 3 });
    expect(fused).toHaveLength(3);
  });

  it("k=0 collapses to 1/rank scoring (still valid)", () => {
    const fused = reciprocalRankFusion([hit("a"), hit("b")], [], { k: 0 });
    expect(fused[0]?.rrfScore).toBeCloseTo(1.0);
    expect(fused[1]?.rrfScore).toBeCloseTo(0.5);
  });

  it("a chunk only in bm25 still appears with vectorRank=null", () => {
    const fused = reciprocalRankFusion([hit("a")], []);
    expect(fused).toHaveLength(1);
    expect(fused[0]?.bm25Rank).toBe(1);
    expect(fused[0]?.vectorRank).toBe(null);
  });
});
