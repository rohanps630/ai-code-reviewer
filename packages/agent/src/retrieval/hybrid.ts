/**
 * Hybrid retrieval orchestrator — the public entry point.
 *
 *   query  ───▶ embed (Voyage)  ─┐
 *           │                    ▼
 *           │             vector lane (pgvector + HNSW + cosine)
 *           │
 *           ▶ BM25 lane (Postgres FTS over content_tsv)
 *                                │
 *                                ▼
 *                       reciprocal rank fusion
 *                                │
 *                                ▼
 *                          SearchResult[]
 *
 * The two lanes run in parallel via `Promise.all`. Cohere reranking is
 * a separate concern that wraps this function in Phase 2.6.
 *
 * Dependency injection:
 *   - `embedder`  → any object with `embedQuery(string): Promise<Vector>`.
 *   - `executor`  → any `{ execute(sql): Promise<rows> }`.
 * Both default to env-backed singletons via {@link searchCode}'s sibling
 * factory, but the underlying {@link HybridRetriever.search} method
 * takes them explicitly so tests can swap them.
 */

import { bm25Search } from "./bm25.js";
import { type Vector, VoyageClient } from "./embeddings.js";
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

    return reciprocalRankFusion(bm25Hits, vectorHits, { k: rrfK, limit });
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
  cachedRetriever = new HybridRetriever({
    embedder: new VoyageClient({ apiKey: serverEnv.VOYAGE_API_KEY }),
    executor: db as unknown as SqlExecutor,
  });
  return cachedRetriever;
}

/** Reset cached singletons. Tests only. */
export function _resetForTests(): void {
  cachedRetriever = null;
}
