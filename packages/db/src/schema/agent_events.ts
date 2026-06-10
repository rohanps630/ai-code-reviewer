import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { reviews } from "./reviews.js";

/**
 * `agent_events` — the persisted agent run/step event stream for a review.
 *
 * Introduced in PR 2 (run/step replay). Each row is one `ReviewChunk` the
 * agent emitted while working a review (status, tool_call, tool_result, text,
 * error, final). Together, ordered by `seq`, they reconstruct the live stream
 * so a review can be replayed after a refresh and inspected later.
 *
 * One review = one agent run, so there is no separate `agent_runs` table — the
 * `reviews` row already holds the run-level metadata (model, status, tokens,
 * cost, cache). These events are the per-step detail.
 *
 * Column notes:
 *   - `review_id`  FK → reviews, cascade-deletes with its review.
 *   - `seq`        0-based order assigned at write time; the replay key.
 *   - `type`       the ReviewChunk discriminant (mirrors @acr/agent ReviewChunk).
 *   - `payload`    jsonb: the full ReviewChunk, replayed verbatim by the UI.
 */
export const agentEvents = pgTable(
  "agent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    review_id: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),

    // Ordering — 0-based within a review, assigned as chunks are emitted.
    seq: integer("seq").notNull(),

    // ReviewChunk discriminant — kept as a column for cheap filtering/queries.
    type: text("type")
      .$type<"status" | "tool_call" | "tool_result" | "text" | "error" | "final">()
      .notNull(),

    // The full ReviewChunk, stored verbatim so replay renders identically.
    payload: jsonb("payload").notNull(),

    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One row per (review, seq); makes batched inserts idempotent and ordered.
    uniqueIndex("agent_events_review_seq_unique_idx").on(table.review_id, table.seq),
    index("agent_events_review_id_idx").on(table.review_id),
  ],
);
