/**
 * Drizzle DB client — single shared instance for the process.
 *
 * Uses postgres-js (not node-postgres): lighter, native ESM, better DX.
 * Import this wherever you need to query the database.
 *
 * The client reads DATABASE_URL directly from process.env so that this
 * module can be imported without triggering the full @acr/shared/env
 * validation (which requires all env vars to be set). The web app's
 * env loader validates DATABASE_URL at startup before this module is used.
 *
 * @example
 * import { db } from "@acr/db/client";
 * const rows = await db.select().from(reviews);
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// why: postgres-js recommends a single connection pool per process.
// max: 10 is a safe default for a serverless/edge environment.
const queryClient = postgres(databaseUrl, { max: 10 });

export const db = drizzle(queryClient, { schema });
