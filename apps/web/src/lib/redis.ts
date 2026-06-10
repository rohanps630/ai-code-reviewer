import { serverEnv } from "@/lib/env";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [50, 100];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/**
 * Zero-dependency Upstash Redis client.
 *
 * Communicates with the Upstash Redis REST API via the /pipeline endpoint to
 * execute commands in a single HTTP POST request. This is robust, avoids
 * URL-encoding issues for large values (like full stringified JSON objects),
 * and requires no external NPM dependencies.
 *
 * @example
 * const client = new RedisClient();
 * if (client.isEnabled()) {
 *   await client.set("key", "value", 3600);
 * }
 */
export class RedisClient {
  private readonly url: string;
  private readonly token: string;

  constructor() {
    this.url = serverEnv.UPSTASH_REDIS_REST_URL ?? "";
    this.token = serverEnv.UPSTASH_REDIS_REST_TOKEN ?? "";
  }

  /**
   * Returns true if both Redis URL and token are configured.
   *
   * @returns True if configured and enabled, false otherwise.
   *
   * @example
   * const enabled = redis.isEnabled();
   */
  isEnabled(): boolean {
    return Boolean(this.url && this.token);
  }

  /**
   * Fetch a string value by key from Redis. Returns null on miss or error.
   *
   * @param key - The key to lookup.
   * @returns The string value associated with the key, or null.
   *
   * @example
   * const val = await redis.get("my-key");
   */
  async get(key: string): Promise<string | null> {
    if (!this.isEnabled()) return null;

    try {
      const response = await this.fetchWithRetry(key, [["GET", key]]);
      if (!response.ok) {
        console.error("[redis] GET request failed:", { status: response.status, key });
        return null;
      }
      const data = (await response.json()) as Array<{ result?: string | null; error?: string }>;
      const item = data[0];
      if (item?.error) {
        console.error("[redis] GET command error:", { error: item.error, key });
        return null;
      }
      return item?.result ?? null;
    } catch (err) {
      console.error("[redis] GET threw:", {
        error: err instanceof Error ? err.message : String(err),
        key,
      });
      return null;
    }
  }

  /**
   * Set a key to a string value with a given TTL in seconds. Returns true on success.
   *
   * @param key - The target key to set.
   * @param value - The string value to store.
   * @param ttlSeconds - Expiration time in seconds.
   * @returns True if the key was set successfully, false otherwise.
   *
   * @example
   * const success = await redis.set("my-key", "my-value", 3600);
   */
  async set(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!this.isEnabled()) return false;

    try {
      const response = await this.fetchWithRetry(key, [["SET", key, value, "EX", ttlSeconds]]);
      if (!response.ok) {
        console.error("[redis] SET request failed:", { status: response.status, key });
        return false;
      }
      const data = (await response.json()) as Array<{ result?: string | null; error?: string }>;
      const item = data[0];
      if (item?.error) {
        console.error("[redis] SET command error:", { error: item.error, key });
        return false;
      }
      return item?.result === "OK";
    } catch (err) {
      console.error("[redis] SET threw:", {
        error: err instanceof Error ? err.message : String(err),
        key,
      });
      return false;
    }
  }

  // ── internals ──────────────────────────────────────────────────────

  private async fetchWithRetry(key: string, commands: unknown[]): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${this.url}/pipeline`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(commands),
        });
      } catch (err) {
        // Network-level failure — always retry
        lastError = err;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 100);
          continue;
        }
        throw err;
      }

      if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
        console.error("[redis] retryable error, will retry:", {
          status: response.status,
          key,
          attempt,
        });
        await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 100);
        continue;
      }

      return response;
    }
    throw lastError ?? new Error("[redis] all retry attempts exhausted");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared, zero-dependency Redis client instance.
 *
 * @example
 * import { redis } from "@/lib/redis";
 * const cached = await redis.get("cache-key");
 */
export const redis = new RedisClient();
