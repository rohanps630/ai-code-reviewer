/**
 * Providers — public surface for the model-agnostic seam.
 *
 * Import a provider constructor to wire a specific backend, or pass a
 * model-id string to `Agent` and let `resolveModel` pick one.
 */

export type {
  ModelProvider,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ToolSpec,
  ToolCall,
  TokenUsage,
  StopReason,
} from "./types.js";
export { ProviderError } from "./types.js";

export { anthropic } from "./anthropic.js";
export type { AnthropicClientLike, AnthropicProviderOptions } from "./anthropic.js";

export { openai } from "./openai.js";
export type { OpenAIClientLike, OpenAIProviderOptions } from "./openai.js";

export { google } from "./google.js";
export type { GoogleClientLike, GoogleProviderOptions } from "./google.js";

export { groq } from "./groq.js";
export type { GroqProviderOptions } from "./groq.js";

export { resolveModel } from "./registry.js";
export type { ModelLike } from "./registry.js";
