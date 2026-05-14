/**
 * Re-exports validated environment variables from @acr/shared.
 *
 * Use `clientEnv` in Client Components and Server Components alike.
 * Use `serverEnv` (or `env`) in Server Components, Route Handlers, and
 * Server Actions only — never in "use client" files.
 *
 * @example
 * import { serverEnv } from "@/lib/env";
 * const db = createClient(serverEnv.DATABASE_URL);
 */
export { clientEnv, env, serverEnv } from "@acr/shared/env";
