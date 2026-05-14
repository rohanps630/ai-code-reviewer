import type { ReviewChunk, ReviewOutput } from "@acr/agent";

/**
 * Hardcoded placeholder review used while the real agent loop is gated
 * behind `Not implemented` (Phase 3 lands the real one). Yields a
 * realistic sequence of ReviewChunks so the UI streaming path can be
 * built and tested end-to-end in Phase 1.
 */
export async function* placeholderReview(): AsyncGenerator<ReviewChunk, void, void> {
  yield { type: "status", message: "Analyzing diff..." };
  await tick();
  yield { type: "status", message: "Identifying patterns..." };
  await tick();

  const intro =
    "This is a placeholder review. The real agent loop with retrieval " +
    "and tool use lands in Phase 3. ";
  for (const word of intro.split(" ")) {
    yield { type: "text", delta: `${word} ` };
    await tick(10);
  }

  const trailer =
    "For now we return a synthetic structured response so the streaming " +
    "wiring can be exercised end to end.";
  for (const word of trailer.split(" ")) {
    yield { type: "text", delta: `${word} ` };
    await tick(10);
  }

  const final: ReviewOutput = {
    summary: "Placeholder review — agent loop not yet implemented.",
    findings: [
      {
        category: "style",
        severity: "minor",
        summary: "Consider adding JSDoc to public exports.",
        locationHint: "diff:1",
        suggestion: "Document the function's purpose, params, and return value.",
      },
      {
        category: "bug",
        severity: "major",
        summary: "Synthetic finding to exercise UI rendering of severities.",
      },
    ],
    confidence: "low",
  };
  yield { type: "final", output: final };
}

function tick(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
