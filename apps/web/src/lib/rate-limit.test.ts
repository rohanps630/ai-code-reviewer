import { afterEach, describe, expect, it, vi } from "vitest";

// clientIpFromRequest reads serverEnv.TRUSTED_PROXY_HOP_COUNT at call time.
const envState = vi.hoisted(() => ({ TRUSTED_PROXY_HOP_COUNT: 1 }));
vi.mock("@/lib/env", () => ({ serverEnv: envState, env: envState, clientEnv: {} }));

import { clientIpFromRequest } from "./rate-limit";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/reviews", { headers });
}

describe("clientIpFromRequest (trusted-hop XFF)", () => {
  afterEach(() => {
    envState.TRUSTED_PROXY_HOP_COUNT = 1;
  });

  it("with 1 trusted hop, uses the right-most (proxy-set) IP", () => {
    envState.TRUSTED_PROXY_HOP_COUNT = 1;
    const ip = clientIpFromRequest(req({ "x-forwarded-for": "203.0.113.7" }));
    expect(ip).toBe("203.0.113.7");
  });

  it("ignores an attacker-prepended spoofed IP", () => {
    envState.TRUSTED_PROXY_HOP_COUNT = 1;
    // Attacker sends "X-Forwarded-For: 1.2.3.4"; the trusted proxy appends the
    // real peer. We must key on the real peer, not the spoof.
    const ip = clientIpFromRequest(req({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }));
    expect(ip).toBe("203.0.113.7");
  });

  it("with 2 trusted hops, reads the 2nd entry from the right", () => {
    envState.TRUSTED_PROXY_HOP_COUNT = 2;
    const ip = clientIpFromRequest(req({ "x-forwarded-for": "9.9.9.9, 203.0.113.7, 10.0.0.1" }));
    expect(ip).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip when XFF is absent", () => {
    envState.TRUSTED_PROXY_HOP_COUNT = 1;
    const ip = clientIpFromRequest(req({ "x-real-ip": "198.51.100.9" }));
    expect(ip).toBe("198.51.100.9");
  });

  it("with 0 trusted hops, does not trust XFF at all", () => {
    envState.TRUSTED_PROXY_HOP_COUNT = 0;
    const ip = clientIpFromRequest(
      req({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "198.51.100.9" }),
    );
    expect(ip).toBe("198.51.100.9");
  });

  it("returns 'anonymous' when no usable header is present", () => {
    envState.TRUSTED_PROXY_HOP_COUNT = 1;
    expect(clientIpFromRequest(req())).toBe("anonymous");
  });
});
