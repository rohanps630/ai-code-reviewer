import { sql } from "drizzle-orm";
import { integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * `reviews` — one row per review request.
 *
 * Introduced in Phase 1. Phase 5 will add cache_status and prompt_cache_tokens
 * columns via a separate migration — do not add them here.
 *
 * Column notes:
 *   - `output`    jsonb: structured review object, null while streaming/pending
 *   - `cost_usd`  numeric(10,6): NEVER float for money (coding-style.md)
 *   - `status`    mirrors the ReviewStatus type in @acr/shared/types
 */
export const reviews = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Input
  diff: text("diff").notNull(),

  // Output (null until the review completes)
  output: jsonb("output"),

  // Lifecycle
  status: text("status")
    .$type<"pending" | "streaming" | "completed" | "failed">()
    .notNull()
    .default("pending"),

  // Model metadata
  model: text("model").notNull(),
  input_tokens: integer("input_tokens"),
  output_tokens: integer("output_tokens"),

  // Cost — numeric, never float (coding-style.md)
  cost_usd: numeric("cost_usd", { precision: 10, scale: 6 }),

  // Timestamps — always timestamptz (coding-style.md)
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
});
