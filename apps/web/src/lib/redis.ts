import { serverEnv } from "@/lib/env";

/**
 * Zero-dependency Upstash Redis client.
 *
 * Communicates with the Upstash Redis REST API via the /pipeline endpoint to
 * execute commands in a single HTTP POST request. This is robust, avoids
 * URL-encoding issues for large values (like full stringified JSON objects),
 * and requires no external NPM dependencies.
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
   */
  isEnabled(): boolean {
    return Boolean(this.url && this.token);
  }

  /**
   * Fetch a string value by key. Returns null on miss or error.
   */
  async get(key: string): Promise<string | null> {
    if (!this.isEnabled()) return null;

    try {
      const response = await fetch(`${this.url}/pipeline`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([["GET", key]]),
      });

      if (!response.ok) return null;
      const data = (await response.json()) as Array<{ result?: string | null; error?: string }>;
      const item = data[0];
      if (item?.error) {
        return null;
      }
      return item?.result ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Set a key to value with a given TTL in seconds. Returns true on success.
   */
  async set(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!this.isEnabled()) return false;

    try {
      const response = await fetch(`${this.url}/pipeline`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([["SET", key, value, "EX", ttlSeconds]]),
      });

      if (!response.ok) return false;
      const data = (await response.json()) as Array<{ result?: string | null; error?: string }>;
      const item = data[0];
      return item?.result === "OK";
    } catch {
      return false;
    }
  }
}

export const redis = new RedisClient();
