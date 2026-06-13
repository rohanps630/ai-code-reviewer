/** Cosine distance below which a semantic cache entry is considered a hit.
 *  distance < threshold ↔ cosine_similarity > (1 − threshold). */
export const SEMANTIC_CACHE_SIMILARITY_THRESHOLD = 0.05;

/** Cache-status values that represent a hit (i.e. not "miss"). */
export type CacheHitStatus = "exact" | "semantic";

/** User-facing status messages for each kind of cache hit. Single source of
 *  truth — consumed by both the POST cache path and the GET stream route. */
export const CACHE_HIT_MESSAGES: Record<CacheHitStatus, string> = {
  exact: "Exact cache hit! Retrieving cached review...",
  semantic: "Semantic cache hit (similarity > 95%)! Retrieving cached review...",
};
