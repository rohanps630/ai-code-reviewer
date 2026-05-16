import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration.
 *
 * - Schema:    packages/db/dist/schema/ (compiled JS, run `tsc --build` first;
 *              the `generate` / `migrate` / `studio` scripts do this for you).
 *              We can't point at TS source because drizzle-kit's loader
 *              doesn't honor NodeNext-style `.js` specifiers in cross-file
 *              imports between schema modules.
 * - Migrations: packages/db/src/migrations/
 * - Dialect:    postgresql (Supabase Postgres 16+)
 * - strict:     true — fail on ambiguous schema changes rather than guessing
 */
export default defineConfig({
  schema: "./dist/schema/*.js",
  out: "./src/migrations",
  dialect: "postgresql",
  strict: true,
  verbose: true,
  dbCredentials: {
    // why: drizzle-kit needs a URL at generate time only for introspection;
    // for `generate` (schema → SQL) it's not used, but the type requires it.
    // We read from env so the config is safe to commit.
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/placeholder",
  },
});
