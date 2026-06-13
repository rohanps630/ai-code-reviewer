/**
 * Minimal API-key authentication guard.
 *
 * When `ACCESS_KEY` is configured (via env), incoming requests must present
 * a matching key, via either:
 *   - the `x-access-key` header (machine clients: CI, the GitHub action), or
 *   - the `acr_key` cookie (browser clients — `fetch`/`EventSource` cannot set
 *     custom headers but always send same-origin cookies).
 *
 * When `ACCESS_KEY` is unset, this guard is a no-op — the API stays open
 * (suitable for local dev and the public demo).
 *
 * Usage:
 *   const denied = checkAccessKey(req);
 *   if (denied) return denied;
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { serverEnv } from "@acr/shared/env";

/** Name of the cookie browser clients use to carry the access key. */
export const ACCESS_KEY_COOKIE = "acr_key";

/**
 * Constant-time string equality.
 *
 * Both inputs are hashed to a fixed-width SHA-256 digest before comparison so
 * that (a) `timingSafeEqual` never throws on length mismatch and (b) neither
 * the match result nor the input length leaks through timing. A plain `===`
 * short-circuits on the first differing byte, letting an attacker recover the
 * key one character at a time from response-latency differentials.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** Extract a single cookie value from a raw `Cookie` header. */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Guard that verifies the access key on an incoming request.
 * Returns a 401 `Response` when verification fails, or `null` when it passes.
 *
 * @param req - The incoming request object.
 * @returns A 401 response if unauthorized, otherwise null.
 *
 * @example
 * const denied = checkAccessKey(req);
 * if (denied) return denied;
 */
export function checkAccessKey(req: Request): Response | null {
  const expected = serverEnv.ACCESS_KEY;
  if (!expected) return null; // No key configured — passthrough

  const provided = req.headers.get("x-access-key") ?? readCookie(req, ACCESS_KEY_COOKIE);
  if (provided && safeEqual(provided, expected)) return null;

  return Response.json({ error: "Unauthorized — provide a valid access key" }, { status: 401 });
}

/**
 * Opaque, stable identifier for the authenticated principal, for stamping
 * `reviews.owner_id` (the tenancy seam). Returns `null` in open mode (no
 * `ACCESS_KEY` configured) or when no key was supplied — those rows are
 * anonymous. We never store the raw key: the id is a SHA-256 prefix of the
 * supplied key, so it's stable per key but reveals nothing about it.
 *
 * Call only after {@link checkAccessKey} has passed.
 *
 * @example
 * const owner = principalId(req); // "key_3f9a…" or null
 */
export function principalId(req: Request): string | null {
  if (!serverEnv.ACCESS_KEY) return null;
  const provided = req.headers.get("x-access-key") ?? readCookie(req, ACCESS_KEY_COOKIE);
  if (!provided) return null;
  const digest = createHash("sha256").update(provided, "utf8").digest("hex");
  return `key_${digest.slice(0, 16)}`;
}
