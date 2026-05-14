/**
 * Zod-validated environment loader for AI Code Reviewer.
 *
 * Split into two schemas:
 *   - `clientEnv`  — NEXT_PUBLIC_* vars, safe to expose to the browser
 *   - `serverEnv`  — server-only secrets, never sent to the client
 *
 * Both are validated once at module load time. A missing required var
 * throws immediately so the process fails fast rather than at runtime.
 *
 * @example
 * import { env } from "@acr/shared/env";
 * const url = env.DATABASE_URL;          // server-only
 * const appUrl = env.NEXT_PUBLIC_APP_URL; // client-safe
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Client-safe schema (NEXT_PUBLIC_* only)
// ---------------------------------------------------------------------------

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

// ---------------------------------------------------------------------------
// Server-only schema (never expose to client)
// ---------------------------------------------------------------------------

const serverSchema = z.object({
  // Runtime
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Database
  DATABASE_URL: z.string().url(),

  // Supabase
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // LLM providers
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1).optional(),

  // Embeddings & rerank
  VOYAGE_API_KEY: z.string().min(1).optional(),
  COHERE_API_KEY: z.string().min(1).optional(),

  // GitHub
  GITHUB_APP_ID: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Code execution sandbox
  E2B_API_KEY: z.string().min(1).optional(),

  // Python jobs (Modal)
  MODAL_TOKEN_ID: z.string().min(1).optional(),
  MODAL_TOKEN_SECRET: z.string().min(1).optional(),

  // Observability
  LANGFUSE_PUBLIC_KEY: z.string().min(1).optional(),
  LANGFUSE_SECRET_KEY: z.string().min(1).optional(),
  LANGFUSE_HOST: z.string().url().default("https://cloud.langfuse.com"),
  SENTRY_DSN: z.string().url().optional(),

  // Evals
  BRAINTRUST_API_KEY: z.string().min(1).optional(),

  // Caching
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Parse and export
// ---------------------------------------------------------------------------

/**
 * Client-safe environment variables (NEXT_PUBLIC_*).
 * Safe to import in browser bundles.
 */
export const clientEnv = clientSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

/**
 * Server-only environment variables.
 * Never import this in client-side code.
 */
export const serverEnv = serverSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  VOYAGE_API_KEY: process.env.VOYAGE_API_KEY,
  COHERE_API_KEY: process.env.COHERE_API_KEY,
  GITHUB_APP_ID: process.env.GITHUB_APP_ID,
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET,
  E2B_API_KEY: process.env.E2B_API_KEY,
  MODAL_TOKEN_ID: process.env.MODAL_TOKEN_ID,
  MODAL_TOKEN_SECRET: process.env.MODAL_TOKEN_SECRET,
  LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
  LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
  LANGFUSE_HOST: process.env.LANGFUSE_HOST,
  SENTRY_DSN: process.env.SENTRY_DSN,
  BRAINTRUST_API_KEY: process.env.BRAINTRUST_API_KEY,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
});

/**
 * Combined env object — server-only. Merges both schemas for convenience
 * in server-side code that needs both client and server vars.
 * Never import in browser bundles.
 */
export const env = { ...clientEnv, ...serverEnv };
