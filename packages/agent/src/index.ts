/**
 * Public API for @acr/agent.
 *
 * Exports the agent loop entry point, the public interface types, and
 * the retrieval surface. Internal modules (prompts, tools) are not
 * re-exported — they are consumed only by loop.ts.
 */
export { runReview } from "./loop.js";
export type { Finding, ReviewChunk, ReviewInput, ReviewOutput } from "./types.js";

// Retrieval — public surface. Consumers should prefer `searchCode`;
// the lane helpers and clients are exposed for the eval harness and
// custom orchestration (e.g. agent loop in Phase 3).
export {
  searchCode,
  HybridRetriever,
  bm25Search,
  vectorSearch,
  reciprocalRankFusion,
  VoyageClient,
  EmbeddingError,
  CohereReranker,
  RerankError,
  toVectorLiteral,
  DEFAULT_SEARCH_OPTIONS,
  rawRowToHit,
} from "./retrieval/index.js";
export type {
  QueryEmbedder,
  HybridRetrieverDeps,
  Reranker,
  CohereRerankerOptions,
  RerankOptions,
  VoyageClientOptions,
  Vector,
  ChunkHit,
  SearchResult,
  SearchOptions,
  RawChunkRow,
} from "./retrieval/index.js";
