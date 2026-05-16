import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { repos } from "./repos.js";

/**
 * `documents` — one row per source file inside an indexed repo.
 *
 * Introduced in Phase 2. A file's `chunks` (one or many) point back here.
 * Incremental re-indexing keys off `content_hash`: same hash → reuse
 * existing chunks; different hash → re-chunk and re-embed.
 *
 * Column notes:
 *   - `path`           repo-relative POSIX path, e.g. "src/auth/login.ts".
 *   - `language`       tree-sitter / language-detection result; null when unknown.
 *   - `content_hash`   sha256 of raw file bytes; cache key for incremental indexing.
 *   - `size_bytes`     captured for skip-too-large policies (e.g. minified, vendored).
 *   - `last_modified`  git commit time of the file's last touch, when available.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    repo_id: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),

    // Identity
    path: text("path").notNull(),
    language: text("language"),

    // Content fingerprint
    content_hash: text("content_hash").notNull(),
    size_bytes: integer("size_bytes").notNull(),
    last_modified: timestamp("last_modified", { withTimezone: true }),

    // Lifecycle
    indexed_at: timestamp("indexed_at", { withTimezone: true }).notNull().defaultNow(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    uniqueIndex("documents_repo_path_unique_idx").on(table.repo_id, table.path),
    index("documents_repo_id_idx").on(table.repo_id),
    index("documents_content_hash_idx").on(table.content_hash),
  ],
);
