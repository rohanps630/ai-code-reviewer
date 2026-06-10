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

  const forwarded = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const ip = forwarded?.split(",")[0]?.trim() ?? realIp ?? "anonymous";

  return limiter.limit(ip);
}
