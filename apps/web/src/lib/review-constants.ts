/** Cosine distance below which a semantic cache entry is considered a hit.
 *  distance < threshold ↔ cosine_similarity > (1 − threshold). */
export const SEMANTIC_CACHE_SIMILARITY_THRESHOLD = 0.05;
