/**
 * Public API for @acr/agent.
 *
 * Exports the agent loop entry point, the public interface types, and
 * the retrieval surface. Internal modules (prompts, tools) are not
 * re-exported — they are consumed only by loop.ts.
 */
export { runReview } from "./loop.js";
export type { Finding, ReviewChunk, ReviewInput, ReviewOutput } from "./types.js";

// Declarative, model-agnostic agent primitive (ADR-003). Separate from
// the code-review `runReview` loop; reuses the tool framework.
export { Agent, AgentMaxIterationsError } from "./agent.js";
export type { AgentConfig, AgentTool } from "./agent.js";

// Provider seam — pass a provider object to `Agent`, or a model-id string.
export { anthropic, openai, google, resolveModel, ProviderError } from "./providers/index.js";
export type {
  ModelProvider,
  ModelLike,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ToolSpec,
  ToolCall,
  TokenUsage,
  StopReason,
  AnthropicClientLike,
  AnthropicProviderOptions,
  OpenAIClientLike,
  OpenAIProviderOptions,
  GoogleClientLike,
  GoogleProviderOptions,
} from "./providers/index.js";

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
