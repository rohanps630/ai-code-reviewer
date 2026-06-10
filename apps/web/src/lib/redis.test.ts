import { afterEach, describe, expect, it, vi } from "vitest";

import { RedisClient } from "./redis";

describe("RedisClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles standard get requests successfully", async () => {
    const mockResponse = [{ result: "cached-value" }];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return {
        ok: true,
        json: async () => mockResponse,
      } as Response;
    });

    // We manually instantiate so the constructor reads whatever env is active in testing
    const client = new RedisClient();
    // Temporarily force credentials if they are missing so it is enabled for the test
    vi.spyOn(client, "isEnabled").mockReturnValue(true);

    const val = await client.get("my-key");
    expect(val).toBe("cached-value");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const call = fetchSpy.mock.calls[0];
    if (!call) throw new Error("fetch not called");
    const [url, init] = call;
    expect(url).toContain("/pipeline");
    expect(JSON.parse(init?.body as string)).toEqual([["GET", "my-key"]]);
  });

  it("handles get cache misses", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return {
        ok: true,
        json: async () => [{ result: null }],
      } as Response;
    });

    const client = new RedisClient();
    vi.spyOn(client, "isEnabled").mockReturnValue(true);

    const val = await client.get("missing-key");
    expect(val).toBeNull();
  });

  it("returns null on get errors or fetch failures", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return {
        ok: false,
      } as Response;
    });

    const client = new RedisClient();
    vi.spyOn(client, "isEnabled").mockReturnValue(true);

    const val = await client.get("error-key");
    expect(val).toBeNull();
  });

  it("handles set requests with TTL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return {
        ok: true,
        json: async () => [{ result: "OK" }],
      } as Response;
    });

    const client = new RedisClient();
    vi.spyOn(client, "isEnabled").mockReturnValue(true);

    const ok = await client.set("my-key", "my-value", 60);
    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const call = fetchSpy.mock.calls[0];
    if (!call) throw new Error("fetch not called");
    const [, init] = call;
    expect(JSON.parse(init?.body as string)).toEqual([["SET", "my-key", "my-value", "EX", 60]]);
  });

  it("returns false on set failures", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return {
        ok: false,
      } as Response;
    });

    const client = new RedisClient();
    vi.spyOn(client, "isEnabled").mockReturnValue(true);

    const ok = await client.set("key", "val", 60);
    expect(ok).toBe(false);
  });
});
