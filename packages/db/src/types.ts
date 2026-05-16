/**
 * Inferred TypeScript types from Drizzle table definitions.
 *
 * Pattern per table:
 *   - `Foo`    — a row as returned by SELECT (all columns present)
 *   - `NewFoo` — a row as accepted by INSERT (required columns only,
 *                 optional/defaulted columns omittable)
 */

import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { chunks } from "./schema/chunks.js";
import type { documents } from "./schema/documents.js";
import type { repos } from "./schema/repos.js";
import type { reviews } from "./schema/reviews.js";

// Phase 1
export type Review = InferSelectModel<typeof reviews>;
export type NewReview = InferInsertModel<typeof reviews>;

// Phase 2 — retrieval
export type Repo = InferSelectModel<typeof repos>;
export type NewRepo = InferInsertModel<typeof repos>;

export type Document = InferSelectModel<typeof documents>;
export type NewDocument = InferInsertModel<typeof documents>;

export type Chunk = InferSelectModel<typeof chunks>;
export type NewChunk = InferInsertModel<typeof chunks>;
