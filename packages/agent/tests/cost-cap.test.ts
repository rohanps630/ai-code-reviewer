import { describe, expect, it } from "vitest";

import { defaultCostCapUsd } from "../src/loop.js";

describe("defaultCostCapUsd (PERF-1: per-model cost cap)", () => {
  it("scales with model price: opus > sonnet > haiku", () => {
    const haiku = defaultCostCapUsd("claude-haiku-4-5-20251001");
    const sonnet = defaultCostCapUsd("claude-sonnet-4-6");
    const opus = defaultCostCapUsd("claude-opus-4-8");
    expect(opus).toBeGreaterThan(sonnet);
    expect(sonnet).toBeGreaterThan(haiku);
  });

  it("gives Opus enough headroom to finish its loop (the old flat $0.50 did not)", () => {
    // Three Opus iterations alone exceed $0.50; the per-model cap must be well
    // above the old flat value so an Opus review can actually complete.
    expect(defaultCostCapUsd("claude-opus-4-8")).toBeGreaterThan(5);
  });

  it("floors cheap/free models at the flat default", () => {
    // Haiku math lands just under $0.50, so it floors at the flat cap; a free
    // local model has zero price and floors there too.
    expect(defaultCostCapUsd("claude-haiku-4-5-20251001")).toBe(0.5);
    expect(defaultCostCapUsd("qwen2.5:7b")).toBe(0.5);
  });

  it("falls back to the flat default for an unknown model (no pricing)", () => {
    expect(defaultCostCapUsd("some-unlisted-model")).toBe(0.5);
  });
});
