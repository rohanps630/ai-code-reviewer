import { afterEach, describe, expect, it, vi } from "vitest";

// Mutable env so each test can toggle ACCESS_KEY. checkAccessKey reads
// serverEnv.ACCESS_KEY at call time, so mutation between tests is observed.
const envState = vi.hoisted(() => ({ ACCESS_KEY: undefined as string | undefined }));
vi.mock("@acr/shared/env", () => ({ serverEnv: envState, env: envState, clientEnv: {} }));

import { ACCESS_KEY_COOKIE, checkAccessKey, principalId } from "./access-key";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/reviews", { headers });
}

describe("checkAccessKey", () => {
  afterEach(() => {
    envState.ACCESS_KEY = undefined;
  });

  it("passes through (null) when no ACCESS_KEY is configured", () => {
    envState.ACCESS_KEY = undefined;
    expect(checkAccessKey(req({ "x-access-key": "anything" }))).toBeNull();
    expect(checkAccessKey(req())).toBeNull();
  });

  it("accepts a matching x-access-key header", () => {
    envState.ACCESS_KEY = "s3cret-key";
    expect(checkAccessKey(req({ "x-access-key": "s3cret-key" }))).toBeNull();
  });

  it("accepts a matching acr_key cookie (browser clients)", () => {
    envState.ACCESS_KEY = "s3cret-key";
    const res = checkAccessKey(req({ cookie: `foo=bar; ${ACCESS_KEY_COOKIE}=s3cret-key` }));
    expect(res).toBeNull();
  });

  it("rejects a missing key with 401", () => {
    envState.ACCESS_KEY = "s3cret-key";
    const res = checkAccessKey(req());
    expect(res?.status).toBe(401);
  });

  it("rejects a wrong key of equal length with 401", () => {
    envState.ACCESS_KEY = "s3cret-key";
    const res = checkAccessKey(req({ "x-access-key": "s3cret-keX" }));
    expect(res?.status).toBe(401);
  });

  it("rejects a wrong key of different length without throwing (timing-safe path)", () => {
    envState.ACCESS_KEY = "s3cret-key";
    // A naive timingSafeEqual on raw buffers throws on length mismatch; the
    // SHA-256 normalization must make this a clean 401 instead.
    expect(() => checkAccessKey(req({ "x-access-key": "x" }))).not.toThrow();
    expect(checkAccessKey(req({ "x-access-key": "x" }))?.status).toBe(401);
  });

  it("rejects a wrong cookie value with 401", () => {
    envState.ACCESS_KEY = "s3cret-key";
    const res = checkAccessKey(req({ cookie: `${ACCESS_KEY_COOKIE}=nope` }));
    expect(res?.status).toBe(401);
  });
});

describe("principalId (tenancy seam)", () => {
  afterEach(() => {
    envState.ACCESS_KEY = undefined;
  });

  it("is null in open mode (no ACCESS_KEY configured)", () => {
    envState.ACCESS_KEY = undefined;
    expect(principalId(req({ "x-access-key": "anything" }))).toBeNull();
  });

  it("is null when authenticated mode but no key supplied", () => {
    envState.ACCESS_KEY = "s3cret-key";
    expect(principalId(req())).toBeNull();
  });

  it("derives a stable, opaque id from the supplied key (never the raw key)", () => {
    envState.ACCESS_KEY = "s3cret-key";
    const id = principalId(req({ "x-access-key": "s3cret-key" }));
    expect(id).toMatch(/^key_[0-9a-f]{16}$/);
    expect(id).not.toContain("s3cret-key");
    // Stable across calls + transport (header vs cookie).
    expect(principalId(req({ cookie: `${ACCESS_KEY_COOKIE}=s3cret-key` }))).toBe(id);
  });
});
