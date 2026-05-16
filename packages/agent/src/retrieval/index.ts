/**
 * Retrieval — public surface.
 *
 * Hybrid BM25 + vector + RRF lives behind {@link searchCode}.
 * Pieces are exported individually so the agent loop (Phase 3+) and the
 * eval harness (Phase 4) can compose them differently.
 *
 * See docs/architecture.md → "Retrieval pipeline" for the design.
 */

export { searchCode, HybridRetriever, _resetForTests } from "./hybrid.js";
export type { QueryEmbedder, HybridRetrieverDeps } from "./hybrid.js";

export { bm25Search } from "./bm25.js";
export { vectorSearch, toVectorLiteral } from "./vector.js";
export { reciprocalRankFusion } from "./rrf.js";

export { VoyageClient, EmbeddingError } from "./embeddings.js";
export type { Vector, VoyageClientOptions } from "./embeddings.js";

export { CohereReranker, RerankError } from "./rerank.js";
export type { Reranker, CohereRerankerOptions, RerankOptions } from "./rerank.js";

export type { ChunkHit, SearchResult, SearchOptions, RawChunkRow } from "./types.js";
export { DEFAULT_SEARCH_OPTIONS, rawRowToHit } from "./types.js";
