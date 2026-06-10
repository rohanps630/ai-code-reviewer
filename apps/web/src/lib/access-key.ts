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
 * Return a 401 Response if the request's `x-access-key` header doesn't
 * match `ACCESS_KEY`. Returns `null` when auth passes (or when no key
 * is configured).
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
