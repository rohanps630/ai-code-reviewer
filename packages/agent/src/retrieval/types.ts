/**
 * Shared types for the retrieval pipeline.
 *
 * These flow:
 *   bm25Search()    \
 *                    } -> reciprocalRankFusion() -> SearchResult[]
 *   vectorSearch()  /
 *
 * The single-lane functions return `ChunkHit[]` ordered by their own
 * relevance score; the fusion step turns those orderings into a unified
 * `SearchResult` list with `rrfScore` and lane-rank breadcrumbs.
 */

import type { Chunk, Document } from "@acr/db";

/** A retrieval candidate from a single search lane (BM25 or vector). */
export type ChunkHit = {
  chunkId: string;
  documentId: string;
  repoId: string;
  path: string;
  content: string;
  contentWithContext: string;
  startLine: number;
  endLine: number;
  symbolName: string | null;
  symbolKind: Chunk["symbol_kind"];
  /** Lane-local score — `ts_rank` for BM25, `1 - cosine_distance` for vector. */
  score: number;
};

/** Final fused result with lane provenance. */
export type SearchResult = ChunkHit & {
  bm25Rank: number | null;
  vectorRank: number | null;
  rrfScore: number;
};

/**
 * Caller-supplied filters and knobs. All fields optional; sane defaults
 * live in {@link DEFAULT_SEARCH_OPTIONS}.
 */
export type SearchOptions = {
  /** Restrict search to a single connected repo. */
  repoId?: string;
  /** Max candidates per lane before fusion (default 30). */
  candidatesPerLane?: number;
  /** Final result count returned after fusion (default 10). */
  limit?: number;
  /** RRF dampening constant (default 60, standard from the original paper). */
  rrfK?: number;
};

export const DEFAULT_SEARCH_OPTIONS = {
  candidatesPerLane: 30,
  limit: 10,
  rrfK: 60,
} as const satisfies Required<Omit<SearchOptions, "repoId">>;

/** Row shape we read from the join of `chunks` + `documents`. Kept as a
 *  type rather than re-using the Drizzle row types so the SQL templates
 *  and the consumer can evolve independently. */
export type RawChunkRow = {
  chunk_id: string;
  document_id: string;
  repo_id: string;
  path: Document["path"];
  content: string;
  content_with_context: string;
  start_line: number;
  end_line: number;
  symbol_name: string | null;
  symbol_kind: Chunk["symbol_kind"];
  /** Lane-specific score column. Postgres returns numeric → string with
   *  drizzle/postgres-js; cast on read. */
  score: string | number;
};

export function rawRowToHit(row: RawChunkRow): ChunkHit {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    repoId: row.repo_id,
    path: row.path,
    content: row.content,
    contentWithContext: row.content_with_context,
    startLine: row.start_line,
    endLine: row.end_line,
    symbolName: row.symbol_name,
    symbolKind: row.symbol_kind,
    score: typeof row.score === "string" ? Number(row.score) : row.score,
  };
}
