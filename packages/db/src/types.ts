/**
 * Inferred TypeScript types from Drizzle table definitions.
 *
 * - `Review`    — a row as returned by SELECT (all columns present)
 * - `NewReview` — a row as accepted by INSERT (required columns only,
 *                 optional columns omitted or nullable)
 */

import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { reviews } from "./schema/reviews.js";

/** A fully-hydrated review row from the database. */
export type Review = InferSelectModel<typeof reviews>;

/** The shape required to insert a new review row. */
export type NewReview = InferInsertModel<typeof reviews>;
