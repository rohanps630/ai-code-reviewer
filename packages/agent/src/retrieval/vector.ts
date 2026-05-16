/**
 * Vector similarity retrieval lane.
 *
 * Uses the HNSW index on `chunks.embedding` with the cosine ops class
 * (created in migration 0001). pgvector exposes cosine distance via the
 * `<=>` operator; we convert to similarity (`1 - distance`) so larger
 * is better, matching the BM25 lane's score direction.
 *
 * The query vector is bound as a parameter; pgvector accepts the
 * `[0.1, 0.2, …]` literal form when cast to `vector(N)`. Drizzle's
 * `sql` template handles parameterization safely.
 *
 * Like `bm25.ts`, this module is db-agnostic — anything with an
 * `execute(sql)` method works, which is enough for tests.
 */

import { sql } from "@acr/db";
import type { Vector } from "./embeddings.js";
import { type ChunkHit, type RawChunkRow, rawRowToHit } from "./types.js";

export type SqlExecutor = {
  execute: (query: ReturnType<typeof sql>) => Promise<RawChunkRow[]> | Promise<unknown>;
};

export type VectorSearchInput = {
  queryVector: Vector;
  limit: number;
  repoId?: string;
};

/** Run the vector lane. Returns rows ordered by cosine similarity (highest first). */
export async function vectorSearch(
  executor: SqlExecutor,
  input: VectorSearchInput,
): Promise<ChunkHit[]> {
  const { queryVector, limit, repoId } = input;
  if (queryVector.length === 0) return [];

  const vectorLiteral = toVectorLiteral(queryVector);
  const filterClause = repoId ? sql`and c.repo_id = ${repoId}::uuid` : sql``;

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
      1 - (c.embedding <=> ${vectorLiteral}::vector) as score
    from chunks c
    join documents d on d.id = c.document_id
    where c.embedding is not null
      ${filterClause}
    order by c.embedding <=> ${vectorLiteral}::vector
    limit ${limit}
  `)) as unknown as RawChunkRow[];

  return rows.map(rawRowToHit);
}

/** Format a JS number[] as the pgvector text literal `"[v1,v2,...]"`.
 *  Exported for tests so a known input → known literal is verifiable. */
export function toVectorLiteral(vector: Vector): string {
  // why: pgvector accepts `[0.1, 0.2]` with bracket delimiters when
  // cast to `vector`; we send a string so postgres-js parameterizes it.
  return `[${vector.join(",")}]`;
}
