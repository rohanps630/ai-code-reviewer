/**
 * Public API for @acr/agent.
 *
 * Exports the agent loop entry point, the public interface types, and
 * the retrieval surface. Internal modules (prompts, tools) are not
 * re-exported — they are consumed only by loop.ts.
 */
export { runReview, routeModel, sanitizeUntrustedText } from "./loop.js";
export type { Finding, ReviewChunk, ReviewInput, ReviewOutput } from "./types.js";

// Declarative, model-agnostic agent runtime (ADR-003, ADR-004). The
// code-review `runReview` loop is a thin specialization of it.
export {
  Agent,
  AgentError,
  AgentMaxIterationsError,
  AgentCostCapError,
  AgentAbortedError,
  AgentTimeoutError,
  AgentNoStopToolError,
  AgentStopToolValidationError,
} from "./agent.js";
export type {
  AgentConfig,
  AgentTool,
  AgentEvent,
  AgentRunOptions,
  AccumulatedUsage,
  AgentStopReason,
  AgentTimeouts,
  AgentHooks,
  BeforeModelCallContext,
  AfterModelCallContext,
  BeforeToolCallContext,
  AfterToolCallContext,
  SkipToolDecision,
  StopToolConfig,
} from "./agent.js";

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
export { defaultE2BFactory } from "./tools/index.js";

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
