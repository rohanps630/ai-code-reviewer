import type { ReviewChunk, ReviewOutput } from "@acr/agent";

/**
 * Shared reducer for the review event stream.
 *
 * The same `ReviewChunk` sequence is consumed in two places:
 *   - live, by `useReviewStream` as chunks arrive over the wire;
 *   - on replay, by the review detail page folding chunks persisted in
 *     `agent_events` back into the same shape.
 *
 * Keeping the reducer here (one source of truth) means a replayed review
 * renders identically to the live run.
 */

export type ReviewUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
};

export type ToolEvent =
  | { kind: "call"; name: string; input: unknown }
  | { kind: "result"; name: string; output: unknown };

export type ReviewStreamState = {
  status: "idle" | "streaming" | "completed" | "failed";
  text: string;
  ticker: string[];
  toolEvents: ToolEvent[];
  final: ReviewOutput | null;
  reviewId: string | null;
  error: string | null;
  usage: ReviewUsage | null;
};

export const INITIAL_REVIEW_STREAM_STATE: ReviewStreamState = {
  status: "idle",
  text: "",
  ticker: [],
  toolEvents: [],
  final: null,
  reviewId: null,
  error: null,
  usage: null,
};

/** Max status messages retained in the ticker. A long review emits one per
 *  iteration plus tool chatter; keeping only the most recent N bounds memory
 *  and avoids an ever-scrolling wall of "Iteration X/10…" lines. */
const MAX_TICKER_MESSAGES = 50;

/** Fold a single chunk into the running state (pure). */
export function applyChunk(state: ReviewStreamState, chunk: ReviewChunk): ReviewStreamState {
  switch (chunk.type) {
    case "status": {
      const ticker = [...state.ticker, chunk.message];
      return {
        ...state,
        ticker: ticker.length > MAX_TICKER_MESSAGES ? ticker.slice(-MAX_TICKER_MESSAGES) : ticker,
      };
    }
    case "text":
      return { ...state, text: state.text + chunk.delta };
    case "error":
      return { ...state, status: "failed", error: chunk.message };
    case "tool_call":
      return {
        ...state,
        toolEvents: [...state.toolEvents, { kind: "call", name: chunk.name, input: chunk.input }],
      };
    case "tool_result":
      return {
        ...state,
        toolEvents: [
          ...state.toolEvents,
          { kind: "result", name: chunk.name, output: chunk.output },
        ],
      };
    case "final":
      return {
        ...state,
        final: chunk.output,
        status: "completed",
        usage: chunk.usage ?? null,
      };
    default:
      return state;
  }
}

/** Reconstruct the full state from an ordered chunk list (used for replay). */
export function reconstructState(
  chunks: ReviewChunk[],
  base: ReviewStreamState = INITIAL_REVIEW_STREAM_STATE,
): ReviewStreamState {
  return chunks.reduce(applyChunk, base);
}
