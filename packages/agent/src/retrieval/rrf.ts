/**
 * Reciprocal Rank Fusion (RRF) — Cormack, Clarke, Büttcher 2009.
 *
 * Combines multiple ranked lists into a single ranking using
 *   score(d) = Σ_lanes 1 / (k + rank_lane(d))
 *
 * Why RRF over weighted-sum-of-scores:
 *   - It's score-free; BM25 and cosine similarity live in different
 *     ranges, and normalizing them is fiddly + brittle to tune.
 *   - It's parameter-light. `k = 60` is the canonical choice from the
 *     paper and works well across domains. Tuning it later via evals
 *     is optional, not required.
 *   - It's monotonic in rank: a chunk that's #1 in BM25 and #1 in
 *     vector always beats a chunk that's #2 in both.
 *
 * The function is pure: no I/O, no async, fully deterministic.
 * That makes it the easiest module in the retrieval folder to test.
 */

import type { ChunkHit, SearchResult } from "./types.js";

export type FuseOptions = {
  /** RRF dampening constant; default 60 per the original paper. */
  k?: number;
  /** Final result count. Default: keep all fused candidates. */
  limit?: number;
};

/**
 * Fuse the BM25 and vector lanes into a single ranked list.
 *
 * Each input list is assumed to already be sorted by lane-local
 * relevance (rank 1 = best). Duplicates across lanes are detected by
 * `chunkId`; their RRF contributions add. Lane-local rank is recorded
 * as a breadcrumb on the result so callers can inspect provenance.
 */
export function reciprocalRankFusion(
  bm25Hits: ChunkHit[],
  vectorHits: ChunkHit[],
  options: FuseOptions = {},
): SearchResult[] {
  const k = options.k ?? 60;

  type Accumulator = {
    hit: ChunkHit;
    bm25Rank: number | null;
    vectorRank: number | null;
    rrfScore: number;
  };

  const byChunkId = new Map<string, Accumulator>();

  bm25Hits.forEach((hit, i) => {
    const rank = i + 1; // 1-based per the RRF formula
    byChunkId.set(hit.chunkId, {
      hit,
      bm25Rank: rank,
      vectorRank: null,
      rrfScore: 1 / (k + rank),
    });
  });

  vectorHits.forEach((hit, i) => {
    const rank = i + 1;
    const contribution = 1 / (k + rank);
    const existing = byChunkId.get(hit.chunkId);
    if (existing) {
      existing.vectorRank = rank;
      existing.rrfScore += contribution;
    } else {
      byChunkId.set(hit.chunkId, {
        hit,
        bm25Rank: null,
        vectorRank: rank,
        rrfScore: contribution,
      });
    }
  });

  const fused: SearchResult[] = [...byChunkId.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(({ hit, bm25Rank, vectorRank, rrfScore }) => ({
      ...hit,
      bm25Rank,
      vectorRank,
      rrfScore,
    }));

  return options.limit !== undefined ? fused.slice(0, options.limit) : fused;
}
