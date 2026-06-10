/**
 * Minimal API-key authentication guard.
 *
 * When `ACCESS_KEY` is configured (via env), incoming requests must include
 * a matching `x-access-key` header. When unset, this guard is a no-op —
 * the API stays open (suitable for local dev).
 *
 * Usage:
 *   const denied = checkAccessKey(req);
 *   if (denied) return denied;
 */

import { serverEnv } from "@acr/shared/env";

/**
 * Guard function that verifies the access key in incoming request headers.
 * Returns a 401 Response if verification fails, or null if it succeeds.
 *
 * @param req - The incoming request object.
 * @returns A response if unauthorized, otherwise null.
 *
 * @example
 * const denied = checkAccessKey(req);
 * if (denied) return denied;
 */
export function checkAccessKey(req: Request): Response | null {
  const expected = serverEnv.ACCESS_KEY;
  if (!expected) return null; // No key configured — passthrough

  const provided = req.headers.get("x-access-key");
  if (provided === expected) return null;

  return Response.json(
    { error: "Unauthorized — provide a valid x-access-key header" },
    { status: 401 },
  );
}
