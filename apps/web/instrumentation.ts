/**
 * Next.js instrumentation hook — runs once on cold boot before any request.
 *
 * Importing env here triggers Zod validation at startup so the process
 * fails loud and fast if required env vars are missing, rather than
 * failing silently on the first request that needs them.
 *
 * Also imports the runtime-appropriate Sentry config so server / edge
 * errors surface with the right context.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  await import("@acr/shared/env");

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
