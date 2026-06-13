import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { serverEnv } from "@/lib/env";

/**
 * Sliding-window rate limiter backed by Upstash Redis.
 *
 * Allows 10 requests per IP per 60-second window. Returns early with
 * `success: true` when Redis credentials are not configured (dev/test).
 */
function createRateLimiter(): Ratelimit | null {
  const url = serverEnv.UPSTASH_REDIS_REST_URL;
  const token = serverEnv.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "\n⚠️  [rate-limit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set.\n" +
          "   Rate limiting is DISABLED in production. Set the Upstash env vars to enable it.\n",
      );
    }
    return null;
  }

  return new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(10, "60 s"),
    prefix: "acr:ratelimit",
  });
}

let _limiter: Ratelimit | null | undefined;

function getLimiter(): Ratelimit | null {
  if (_limiter === undefined) {
    _limiter = createRateLimiter();
  }
  return _limiter;
}

/**
 * Resolve the client IP used as the rate-limit key.
 *
 * `X-Forwarded-For` is client-controllable: anyone can send
 * `X-Forwarded-For: 1.2.3.4` to ride someone else's bucket (or evade their
 * own). A trusted reverse proxy *appends* the real peer IP to the right of
 * the list, so with `TRUSTED_PROXY_HOP_COUNT = n` the trustworthy value is the
 * n-th entry from the right — everything to its left is attacker-supplied and
 * ignored. With `n = 0` we don't trust XFF at all.
 *
 * @example
 * // hops=1, header "9.9.9.9, 203.0.113.7" → "203.0.113.7" (proxy-set)
 * const ip = clientIpFromRequest(req);
 */
export function clientIpFromRequest(req: Request): string {
  const hops = serverEnv.TRUSTED_PROXY_HOP_COUNT;
  const forwarded = req.headers.get("x-forwarded-for");

  if (hops > 0 && forwarded) {
    const chain = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const ip = chain[chain.length - hops];
    if (ip) return ip;
  }

  return req.headers.get("x-real-ip")?.trim() ?? "anonymous";
}

/**
 * Applies sliding-window rate limiting based on the requester's IP address.
 *
 * @param req - The incoming request object.
 * @returns Rate limit status containing success status and window details.
 *
 * @example
 * const { success } = await applyRateLimit(req);
 * if (!success) return new Response("Rate limit exceeded", { status: 429 });
 */
export async function applyRateLimit(
  req: Request,
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  const limiter = getLimiter();
  if (!limiter) {
    return { success: true, limit: 10, remaining: 10, reset: 0 };
  }

  return limiter.limit(clientIpFromRequest(req));
}
