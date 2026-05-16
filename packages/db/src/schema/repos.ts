import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * `repos` — a GitHub repository connected to the reviewer.
 *
 * Introduced in Phase 2 (retrieval). Each row is one indexable repo;
 * `documents` and `chunks` join back here.
 *
 * Column notes:
 *   - `url`                  canonical "https://github.com/<owner>/<name>"; unique.
 *   - `default_branch`       what the indexer pulls; can change over time.
 *   - `last_indexed_at`      null until first successful index pass.
 *   - `last_indexed_commit`  sha of the commit indexed; powers incremental re-indexing.
 *   - `status`               'pending' | 'indexing' | 'indexed' | 'failed'.
 */
export const repos = pgTable(
  "repos",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Identity
    url: text("url").notNull(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    default_branch: text("default_branch").notNull().default("main"),

    // Indexing state
    last_indexed_at: timestamp("last_indexed_at", { withTimezone: true }),
    last_indexed_commit: text("last_indexed_commit"),
    status: text("status")
      .$type<"pending" | "indexing" | "indexed" | "failed">()
      .notNull()
      .default("pending"),

    // Timestamps — always timestamptz (coding-style.md)
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    uniqueIndex("repos_url_unique_idx").on(table.url),
    index("repos_owner_name_idx").on(table.owner, table.name),
  ],
);
