/**
 * Hybrid retrieval orchestrator — the public entry point.
 *
 *   query ─┬─▶ Voyage embedQuery() ─▶ vector lane (pgvector + HNSW + cosine)
 *          │                                       │
 *          └─▶ BM25 lane (Postgres FTS / ts_rank)  │
 *                              │                   ▼
 *                              └─▶ RRF (k=60) ─┐
 *                                              ▼
 *                              [optional] Cohere rerank-v3.5
 *                                              ▼
 *                                       SearchResult[]
 *
 * The two retrieval lanes run in parallel via `Promise.all`. Rerank is
 * applied iff a `reranker` is wired into the retriever's deps. With
 * rerank: candidatesPerLane controls how wide we search; `limit`
 * controls how many survive rerank. Without rerank: `limit` is just
 * the top-N of the RRF list.
 *
 * Dependency injection:
 *   - `embedder`  → any object with `embedQuery(string): Promise<Vector>`.
 *   - `executor`  → any `{ execute(sql): Promise<rows> }`.
 *   - `reranker`  → optional; any object satisfying {@link Reranker}.
 * The {@link HybridRetriever.search} method takes them explicitly so
 * tests can swap them; the env-backed {@link searchCode} convenience
 * wires Voyage + Cohere + the db client.
 */

import { bm25Search } from "./bm25.js";
import { type Vector, VoyageClient } from "./embeddings.js";
import { CohereReranker, type Reranker } from "./rerank.js";
import { reciprocalRankFusion } from "./rrf.js";
import { DEFAULT_SEARCH_OPTIONS, type SearchOptions, type SearchResult } from "./types.js";
import { vectorSearch } from "./vector.js";

export interface QueryEmbedder {
  embedQuery: (query: string) => Promise<Vector>;
}

export interface SqlExecutor {
  execute: (query: unknown) => Promise<unknown>;
}

export type HybridRetrieverDeps = {
  embedder: QueryEmbedder;
  executor: SqlExecutor;
  /** Optional cross-encoder rerank step. When present, RRF feeds it the
   *  top `candidatesPerLane` * 2 chunks and the reranker returns `limit`. */
  reranker?: Reranker;
};

export class HybridRetriever {
  constructor(private readonly deps: HybridRetrieverDeps) {}

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const candidatesPerLane = options.candidatesPerLane ?? DEFAULT_SEARCH_OPTIONS.candidatesPerLane;
    const limit = options.limit ?? DEFAULT_SEARCH_OPTIONS.limit;
    const rrfK = options.rrfK ?? DEFAULT_SEARCH_OPTIONS.rrfK;

    const [bm25Hits, queryVector] = await Promise.all([
      bm25Search(this.deps.executor as Parameters<typeof bm25Search>[0], {
        query: trimmed,
        limit: candidatesPerLane,
        repoId: options.repoId,
      }),
      this.deps.embedder.embedQuery(trimmed),
    ]);

    const vectorHits = await vectorSearch(
      this.deps.executor as Parameters<typeof vectorSearch>[0],
      {
        queryVector,
        limit: candidatesPerLane,
        repoId: options.repoId,
      },
    );

    // Without a reranker the RRF cap IS the final cap.
    // With a reranker we let RRF emit a wider candidate pool (up to
    // 2× candidatesPerLane, deduped) and let Cohere narrow it.
    const rrfLimit = this.deps.reranker ? candidatesPerLane * 2 : limit;
    const fused = reciprocalRankFusion(bm25Hits, vectorHits, { k: rrfK, limit: rrfLimit });

    if (!this.deps.reranker || fused.length === 0) return fused.slice(0, limit);
    return this.deps.reranker.rerank(trimmed, fused, { topN: limit });
  }
}

/** Convenience: build a {@link HybridRetriever} backed by env-configured
 *  defaults. Reads VOYAGE_API_KEY through `@acr/shared/env` and the db
 *  client through `@acr/db/client`. Server-only — never import on the
 *  client. */
export async function searchCode(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const retriever = await defaultRetriever();
  return retriever.search(query, options);
}

let cachedRetriever: HybridRetriever | null = null;

async function defaultRetriever(): Promise<HybridRetriever> {
  if (cachedRetriever) return cachedRetriever;

  // Dynamic imports keep this module importable from places that don't
  // have env configured yet (e.g. type-only imports in tests).
  const [{ serverEnv }, { db }] = await Promise.all([
    import("@acr/shared/env"),
    import("@acr/db/client"),
  ]);
  if (!serverEnv.VOYAGE_API_KEY) {
    throw new Error("VOYAGE_API_KEY is not set. Configure it before calling searchCode().");
  }
  // Reranker is optional — if COHERE_API_KEY isn't set we skip the
  // rerank step rather than refusing to retrieve. Recall stays good;
  // precision is what suffers, which we'll catch in the eval suite.
  const reranker = serverEnv.COHERE_API_KEY
    ? new CohereReranker({ apiKey: serverEnv.COHERE_API_KEY })
    : undefined;
  cachedRetriever = new HybridRetriever({
    embedder: new VoyageClient({ apiKey: serverEnv.VOYAGE_API_KEY }),
    executor: db as unknown as SqlExecutor,
    reranker,
  });
  return cachedRetriever;
}

/** Reset cached singletons. Tests only. */
export function _resetForTests(): void {
  cachedRetriever = null;
}
