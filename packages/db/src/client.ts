/**
 * Drizzle DB client — single shared instance for the process.
 *
 * Uses postgres-js (not node-postgres): lighter, native ESM, better DX.
 * Import this wherever you need to query the database.
 *
 * Reads `DATABASE_URL` through `@acr/shared/env` so all env access in
 * the monorepo flows through one validated source. This module is
 * server-only — importing it on the client raises a `postgres-js`
 * runtime error.
 *
 * @example
 * import { db } from "@acr/db/client";
 * const rows = await db.select().from(reviews);
 */

import { serverEnv } from "@acr/shared/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

// In non-production, @acr/shared/env passes values through unvalidated,
// so DATABASE_URL may be undefined. Fail loud here rather than handing
// `undefined` to postgres-js.
if (!serverEnv.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — @acr/db/client cannot connect");
}

// why: postgres-js recommends a single connection pool per process.
// max: 10 is a safe default for a serverless/edge environment.
const queryClient = postgres(serverEnv.DATABASE_URL, { max: 10 });

export const db = drizzle(queryClient, { schema });
