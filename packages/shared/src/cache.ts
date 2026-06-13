/**
 * Pure cache primitives shared by the review API (lookup) and the worker
 * (populate). Keeping them here — in the leaf `@acr/shared` package — means
 * both sides compute identical keys and embedding inputs, so a write from the
 * worker is always found by a later read from the route.
 */

import { createHash } from "node:crypto";

/** Exact (Redis) cache TTL — 7 days. */
export const EXACT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Semantic (pgvector) cache TTL — 24 hours. */
export const SEMANTIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Redis key for the exact-match cache.
 *
 * Keyed by the **concrete model id** (e.g. `claude-sonnet-4-6`), never the
 * tier label (`sonnet`). When a tier is repointed to a new model, the key
 * changes too, so stale outputs from the old model are never served as if the
 * new model produced them.
 *
 * @example
 * exactCacheKey("claude-sonnet-4-6", diff); // "exact_cache:claude-sonnet-4-6:<sha256>"
 */
export function exactCacheKey(modelId: string, diff: string): string {
  const diffHash = createHash("sha256").update(diff).digest("hex");
  return `exact_cache:${modelId}:${diffHash}`;
}

/** Lines we keep when summarizing a diff: file headers and hunk headers. */
const STRUCTURAL_PREFIXES = ["diff --git ", "+++ ", "--- ", "@@"] as const;

/**
 * Build a compact, deterministic representation of a diff for embedding.
 *
 * voyage-code-3 has a ~16K-token window; a 500 KB diff is ~125K tokens, so
 * embedding the raw diff silently truncates or errors and the resulting vector
 * is meaningless. We keep only the signal — file paths, hunk headers, and
 * added/removed lines — and drop unchanged context plus `index`/hash noise,
 * then bound the result well under the token limit. Same diff → same summary →
 * same embedding, so cache reads and writes line up.
 *
 * @example
 * const summary = summarizeDiffForEmbedding(diff);
 * const vec = await embedder.embedQuery(summary);
 */
export function summarizeDiffForEmbedding(diff: string): string {
  const kept: string[] = [];
  for (const line of diff.split("\n")) {
    const isStructural = STRUCTURAL_PREFIXES.some((p) => line.startsWith(p));
    const isChange =
      (line.startsWith("+") || line.startsWith("-")) &&
      !line.startsWith("+++") &&
      !line.startsWith("---");
    if (isStructural || isChange) kept.push(line);
  }
  const summary = kept.join("\n");
  // ~4 chars/token → 40K chars ≈ 10K tokens, comfortably under the 16K window.
  const MAX_SUMMARY_CHARS = 40_000;
  return summary.length > MAX_SUMMARY_CHARS ? summary.slice(0, MAX_SUMMARY_CHARS) : summary;
}
