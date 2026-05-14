import { describe, expect, expectTypeOf, it } from "vitest";
import { runReview } from "../src/loop.js";
import { CURRENT_PROMPT_VERSION, CURRENT_SYSTEM_PROMPT } from "../src/prompts/index.js";
import type { Finding, ReviewChunk, ReviewOutput } from "../src/types.js";

// ---------------------------------------------------------------------------
// loop.ts — stub behaviour
// ---------------------------------------------------------------------------

describe("runReview stub", () => {
  it("throws 'Not implemented' when the generator is advanced", async () => {
    const gen = runReview({ diff: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new" });
    await expect(gen.next()).rejects.toThrow("Not implemented");
  });

  it("throws an Error instance (not a string)", async () => {
    const gen = runReview({ diff: "diff" });
    await expect(gen.next()).rejects.toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// types.ts — shape smoke tests (compile-time via expectTypeOf)
// ---------------------------------------------------------------------------

describe("Finding type shape", () => {
  it("accepts a valid Finding literal", () => {
    const f: Finding = {
      category: "bug",
      severity: "critical",
      summary: "Null pointer dereference",
      locationHint: "src/auth.ts:42",
      suggestion: "Add a null check before accessing .user",
    };
    expectTypeOf(f.category).toEqualTypeOf<"bug" | "perf" | "security" | "style" | "logic">();
    expectTypeOf(f.severity).toEqualTypeOf<"critical" | "major" | "minor">();
    expect(f.summary).toBeTruthy();
  });

  it("accepts a Finding without optional fields", () => {
    const f: Finding = { category: "style", severity: "minor", summary: "Missing semicolon" };
    expect(f.locationHint).toBeUndefined();
    expect(f.suggestion).toBeUndefined();
  });
});

describe("ReviewOutput type shape", () => {
  it("accepts a valid ReviewOutput literal", () => {
    const output: ReviewOutput = {
      summary: "Looks good overall.",
      findings: [],
      confidence: "high",
    };
    expectTypeOf(output.confidence).toEqualTypeOf<"high" | "medium" | "low">();
    expect(output.findings).toHaveLength(0);
  });
});

describe("ReviewChunk discriminated union", () => {
  it("narrows to text chunk correctly", () => {
    const chunk: ReviewChunk = { type: "text", delta: "hello" };
    if (chunk.type === "text") {
      expectTypeOf(chunk.delta).toEqualTypeOf<string>();
      expect(chunk.delta).toBe("hello");
    }
  });

  it("narrows to final chunk correctly", () => {
    const chunk: ReviewChunk = {
      type: "final",
      output: { summary: "done", findings: [], confidence: "low" },
    };
    if (chunk.type === "final") {
      expectTypeOf(chunk.output).toEqualTypeOf<ReviewOutput>();
      expect(chunk.output.confidence).toBe("low");
    }
  });
});

// ---------------------------------------------------------------------------
// prompts/index.ts
// ---------------------------------------------------------------------------

describe("prompts", () => {
  it("CURRENT_SYSTEM_PROMPT is a non-empty string", () => {
    expect(typeof CURRENT_SYSTEM_PROMPT).toBe("string");
    expect(CURRENT_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("CURRENT_PROMPT_VERSION is v0.1", () => {
    expect(CURRENT_PROMPT_VERSION).toBe("v0.1");
  });
});
