import { index, pgTable, text, timestamp, uuid, vector } from "drizzle-orm/pg-core";

/**
 * `semantic_cache` — cached review outputs indexed by Voyage embeddings of the diffs.
 *
 * Introduced in Phase 5.
 *
 * Columns:
 *   - `diff`       the raw diff text (for auditing/debugging).
 *   - `model`      the model targeted for the review.
 *   - `response`   JSON string of the serialized ReviewOutput object.
 *   - `embedding`  voyage-code-3 vector(1024) of the diff text.
 *   - `expires_at` TTL expiration (enforces the 1-day TTL constraint).
 */
export const semanticCache = pgTable(
  "semantic_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    diff: text("diff").notNull(),
    model: text("model").notNull(),
    response: text("response").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("semantic_cache_expires_at_idx").on(table.expires_at),
    index("semantic_cache_embedding_hnsw_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);
