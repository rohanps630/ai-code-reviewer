import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

import { documents } from "./documents.js";
import { repos } from "./repos.js";

/**
 * `chunks` — AST-aware slices of a document, the unit of retrieval.
 *
 * Introduced in Phase 2. Produced by the Python indexer using tree-sitter
 * (a function, a class, a top-level block) and embedded with Voyage
 * `voyage-code-3` (1024-dim).
 *
 * Hybrid retrieval reads this table two ways:
 *   - **Vector**: HNSW index over `embedding` with cosine ops.
 *   - **BM25**:  GIN index over a generated `content_tsv` tsvector column
 *                (added by the migration's raw-SQL tail; Drizzle has no
 *                first-class tsvector type yet).
 *
 * Column notes:
 *   - `repo_id`              denormalized from `documents.repo_id` so
 *                            per-repo filters stay on a single hot index.
 *   - `chunk_index`          0-based ordering inside the document.
 *   - `content`              the raw chunk source.
 *   - `content_with_context` chunk prefixed with file path / scope hints
 *                            (Anthropic's contextual-retrieval pattern);
 *                            this is what we embed, not `content`.
 *   - `symbol_name|kind`     extracted from the AST when applicable.
 *   - `content_hash`         sha256 of `content`; powers chunk-level cache.
 *   - `embedding`            voyage-code-3 vector(1024); nullable until
 *                            the embedding step lands the row.
 */
export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    document_id: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    repo_id: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),

    // Ordering + location
    chunk_index: integer("chunk_index").notNull(),
    start_line: integer("start_line").notNull(),
    end_line: integer("end_line").notNull(),

    // Content
    content: text("content").notNull(),
    content_with_context: text("content_with_context").notNull(),

    // AST metadata
    symbol_name: text("symbol_name"),
    symbol_kind: text("symbol_kind").$type<"function" | "class" | "method" | "module" | "block">(),

    // Fingerprints
    content_hash: text("content_hash").notNull(),

    // Vector — voyage-code-3 dim. Nullable until embedding completes.
    embedding: vector("embedding", { dimensions: 1024 }),

    // Timestamps
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    uniqueIndex("chunks_document_chunk_index_unique_idx").on(table.document_id, table.chunk_index),
    index("chunks_document_id_idx").on(table.document_id),
    index("chunks_repo_id_idx").on(table.repo_id),
    index("chunks_content_hash_idx").on(table.content_hash),
    // HNSW vector index — cosine similarity matches the voyage embedding
    // training objective. The GIN index on the generated tsvector column
    // is added by the migration's raw-SQL tail (Drizzle has no tsvector
    // column type yet).
    index("chunks_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);
