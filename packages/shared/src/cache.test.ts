import { describe, expect, it } from "vitest";

import { exactCacheKey, summarizeDiffForEmbedding } from "./cache.js";

describe("exactCacheKey", () => {
  it("is deterministic for the same (model, diff)", () => {
    expect(exactCacheKey("claude-sonnet-4-6", "abc")).toBe(
      exactCacheKey("claude-sonnet-4-6", "abc"),
    );
  });

  it("changes with the model id (ARCH-4: tier repoint invalidates)", () => {
    expect(exactCacheKey("claude-sonnet-4-6", "abc")).not.toBe(
      exactCacheKey("claude-opus-4-8", "abc"),
    );
  });

  it("changes with the diff", () => {
    expect(exactCacheKey("m", "abc")).not.toBe(exactCacheKey("m", "abd"));
  });

  it("uses the exact_cache:<model>:<sha256> shape", () => {
    expect(exactCacheKey("m", "abc")).toMatch(/^exact_cache:m:[0-9a-f]{64}$/);
  });
});

describe("summarizeDiffForEmbedding", () => {
  const diff = [
    "diff --git a/src/auth.ts b/src/auth.ts",
    "index 111..222 100644",
    "--- a/src/auth.ts",
    "+++ b/src/auth.ts",
    "@@ -1,3 +1,3 @@",
    " const unchanged = 1;",
    "-const old = 2;",
    "+const fresh = 3;",
  ].join("\n");

  it("keeps file headers, hunk headers, and changed lines", () => {
    const out = summarizeDiffForEmbedding(diff);
    expect(out).toContain("diff --git a/src/auth.ts b/src/auth.ts");
    expect(out).toContain("@@ -1,3 +1,3 @@");
    expect(out).toContain("-const old = 2;");
    expect(out).toContain("+const fresh = 3;");
  });

  it("drops unchanged context and index/hash noise", () => {
    const out = summarizeDiffForEmbedding(diff);
    expect(out).not.toContain("const unchanged = 1;");
    expect(out).not.toContain("index 111..222");
  });

  it("is deterministic", () => {
    expect(summarizeDiffForEmbedding(diff)).toBe(summarizeDiffForEmbedding(diff));
  });

  it("bounds the output well under the embedder's token window", () => {
    const huge = `diff --git a/x b/x\n${Array.from({ length: 50_000 }, (_, i) => `+line ${i}`).join("\n")}`;
    expect(summarizeDiffForEmbedding(huge).length).toBeLessThanOrEqual(40_000);
  });
});
