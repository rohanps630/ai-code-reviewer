import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration.
 *
 * - Schema: packages/db/src/schema/ (all *.ts files)
 * - Migrations: packages/db/src/migrations/
 * - Dialect: postgresql (Supabase Postgres 16+)
 * - strict: true — fail on ambiguous schema changes rather than guessing
 */
export default defineConfig({
  schema: "./src/schema/reviews.ts",
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
