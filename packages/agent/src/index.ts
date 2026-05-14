/**
 * Public API for @acr/agent.
 *
 * Exports the agent loop entry point and all public interface types.
 * Internal modules (prompts, tools, retrieval) are not re-exported here —
 * they are implementation details consumed only by loop.ts.
 */
export { runReview } from "./loop.js";
export type {
  Finding,
  ReviewChunk,
  ReviewInput,
  ReviewOutput,
} from "./types.js";
