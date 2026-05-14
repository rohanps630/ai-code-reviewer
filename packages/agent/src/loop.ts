import type { ReviewChunk, ReviewInput } from "./types.js";

/**
 * runReview — the agent loop entry point.
 *
 * ⚠️  PROTECTED FILE — see AGENTS.md § 7.
 * This stub will be replaced with the real implementation in Phase 3.
 * Do not add logic here. The /api/reviews route catches the thrown error
 * and falls back to a placeholder stream for Phase 1.
 *
 * @param _input - The review request (diff + optional context).
 * @yields ReviewChunk — status updates, tool calls, streamed text, final output.
 */
export async function* runReview(_input: ReviewInput): AsyncGenerator<ReviewChunk, void, void> {
  throw new Error(
    "Not implemented. Real agent loop lands in Phase 3. " +
      "For Phase 1, the /api/reviews route should catch this and " +
      "fall back to a placeholder stream.",
  );

  // Unreachable, but required for the AsyncGenerator return-type contract.
  // biome-ignore lint/correctness/noUnreachable: intentional — satisfies AsyncGenerator<ReviewChunk> return type
  yield { type: "final", output: { summary: "", findings: [], confidence: "low" } };
}
