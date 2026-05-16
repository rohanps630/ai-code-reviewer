/**
 * BM25-style lexical retrieval lane.
 *
 * Uses the `chunks.content_tsv` generated tsvector column (added in
 * migration 0001) with Postgres's `ts_rank_cd`. Strictly speaking this
 * is `tf-idf` weighted by cover density, not literal BM25 — but in
 * Postgres FTS the two are close enough that we use the BM25 label
 * throughout the project to align with the RAG literature.
 *
 * Why `plainto_tsquery` (and not `websearch_to_tsquery` or raw
 * `to_tsquery`):
 *   - `plainto_tsquery` is the safe default for free-text user queries.
 *     It strips operators, splits on whitespace, ANDs the terms.
 *     `websearch_to_tsquery` supports phrase/exclusion syntax but is
 *     overkill for the agent's typical "what does this PR do" queries.
 *     `to_tsquery` would explode on user-supplied special characters.
 *
 * Tests mock the db layer so this module never opens a real Postgres
 * connection.
 */

import { sql } from "@acr/db";
import { type ChunkHit, type RawChunkRow, rawRowToHit } from "./types.js";

/** Minimal contract over `@acr/db/client`'s `db` so this module can be
 *  tested without an actual Postgres. Both drizzle's db and a raw
 *  postgres-js client expose `.execute(sql)` returning rows. */
export type SqlExecutor = {
  execute: (query: ReturnType<typeof sql>) => Promise<RawChunkRow[]> | Promise<unknown>;
};

export type Bm25SearchInput = {
  query: string;
  limit: number;
  repoId?: string;
};

/** Run the lexical lane. Returns rows ordered by `ts_rank_cd` descending. */
export async function bm25Search(
  executor: SqlExecutor,
  input: Bm25SearchInput,
): Promise<ChunkHit[]> {
  const { query, limit, repoId } = input;
  if (!query.trim()) return [];

  const filterClause = repoId ? sql`and c.repo_id = ${repoId}::uuid` : sql``;

  const queryExpr = sql`plainto_tsquery('english', ${query})`;

  const rows = (await executor.execute(sql`
    select
      c.id            as chunk_id,
      c.document_id   as document_id,
      c.repo_id       as repo_id,
      d.path          as path,
      c.content       as content,
      c.content_with_context as content_with_context,
      c.start_line    as start_line,
      c.end_line      as end_line,
      c.symbol_name   as symbol_name,
      c.symbol_kind   as symbol_kind,
      ts_rank_cd(c.content_tsv, ${queryExpr}) as score
    from chunks c
    join documents d on d.id = c.document_id
    where c.content_tsv @@ ${queryExpr}
      ${filterClause}
    order by score desc
    limit ${limit}
  `)) as unknown as RawChunkRow[];

  return rows.map(rawRowToHit);
}
