/**
 * Public API for @acr/db.
 *
 * Exports:
 *   - Table definitions (for use in queries)
 *   - Inferred TypeScript types (for use in application code)
 *
 * The DB client is intentionally NOT re-exported here — import it
 * directly from "@acr/db/client" to keep the client instantiation
 * explicit and avoid accidental imports in non-server contexts.
 *
 * @example
 * import { reviews, type Review, type NewReview } from "@acr/db";
 */

// Table definitions
export { reviews } from "./schema/index.js";

// Inferred types — use these in application code, not raw Drizzle types
export type { Review, NewReview } from "./types.js";

// Query helpers — re-exported so consumers use the same drizzle-orm
// instance that @acr/db's schema definitions were built against, avoiding
// dual-instance type incompatibility under pnpm peer-dep splitting.
export { eq, and, or, desc, asc, sql } from "drizzle-orm";
