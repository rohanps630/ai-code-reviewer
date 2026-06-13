/**
 * Runtime validation for `ReviewOutput` values read back from untrusted-ish
 * stores (the `reviews.output` JSONB column, cache payloads).
 *
 * The DB column is typed `jsonb`, so TypeScript only knows it's `unknown` at
 * the boundary — a corrupt or hand-edited row would otherwise flow straight
 * into the UI as a malformed object and blow up on first property access.
 * Everything that materializes a `ReviewOutput` from storage must go through
 * {@link parseReviewOutput} rather than an `as` cast.
 */

import type { ReviewOutput } from "@acr/agent";
import { z } from "zod";

const FindingSchema = z.object({
  category: z.enum(["bug", "perf", "security", "style", "logic"]),
  severity: z.enum(["critical", "major", "minor"]),
  summary: z.string(),
  locationHint: z.string().optional(),
  suggestion: z.string().optional(),
});

/** Canonical shape of a persisted review output. */
export const ReviewOutputSchema = z.object({
  summary: z.string(),
  findings: z.array(FindingSchema),
  confidence: z.enum(["high", "medium", "low"]),
});

/**
 * Parse an unknown value (e.g. a JSONB column) into a `ReviewOutput`.
 * Returns `null` on any shape mismatch — callers treat that as "no output",
 * never as a runtime crash.
 *
 * @example
 * const output = parseReviewOutput(review.output);
 * if (output) renderFindings(output.findings);
 */
export function parseReviewOutput(value: unknown): ReviewOutput | null {
  if (value == null) return null;
  const parsed = ReviewOutputSchema.safeParse(value);
  return parsed.success ? (parsed.data as ReviewOutput) : null;
}
