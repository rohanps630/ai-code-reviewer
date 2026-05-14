/**
 * Next.js instrumentation hook — runs once on cold boot before any request.
 *
 * Importing env here triggers Zod validation at startup so the process
 * fails loud and fast if required env vars are missing, rather than
 * failing silently on the first request that needs them.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Trigger env validation on startup. The import itself throws if any
  // required var is missing — that's the intended behaviour.
  await import("@acr/shared/env");
}
