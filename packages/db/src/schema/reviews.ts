import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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
/**
 * Database table schema for tracking code review requests and results.
 *
 * @example
 * import { reviews } from "@acr/db";
 * const results = await db.select().from(reviews);
 */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Input
    diff: text("diff").notNull(),

    // Output (null until the review completes)
    output: jsonb("output"),

    // Ownership / tenancy seam. Nullable: null = anonymous (open mode). When a
    // request authenticates, this holds an opaque, stable principal id. Adding
    // it now — while the table is small — means the eventual move to real
    // per-user auth is an additive change, not a backfill-onto-anonymous-rows
    // decision. Indexed for "my reviews" / per-tenant queries.
    owner_id: text("owner_id"),

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

    // Caching metadata (Phase 5)
    cache_status: text("cache_status")
      .$type<"exact" | "semantic" | "miss">()
      .notNull()
      .default("miss"),
    prompt_cache_tokens: integer("prompt_cache_tokens").notNull().default(0),

    // Timestamps — always timestamptz (coding-style.md)
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  // The reviews list page orders by `created_at desc` (paginated) and the
  // worker poll selects the oldest `pending` row by `created_at asc`. Without
  // an index both are sequential scans that degrade as the table grows. A
  // b-tree on created_at serves both directions (Postgres scans it backward
  // for desc).
  (table) => [
    index("reviews_created_at_idx").on(table.created_at),
    // Supports per-owner listing once auth lands; partial-free b-tree is fine
    // (nulls are excluded from "where owner_id = $1" scans).
    index("reviews_owner_id_idx").on(table.owner_id),
  ],
);
