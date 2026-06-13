import { describe, expect, it } from "vitest";

import { parseReviewOutput } from "./review-output";

describe("parseReviewOutput", () => {
  const valid = {
    summary: "Looks fine.",
    findings: [
      { category: "bug", severity: "critical", summary: "Null deref", locationHint: "a.ts:1" },
    ],
    confidence: "high",
  };

  it("returns the parsed output for a valid shape", () => {
    const out = parseReviewOutput(valid);
    expect(out?.summary).toBe("Looks fine.");
    expect(out?.findings).toHaveLength(1);
  });

  it("returns null for null/undefined", () => {
    expect(parseReviewOutput(null)).toBeNull();
    expect(parseReviewOutput(undefined)).toBeNull();
  });

  it("returns null when a required field is missing", () => {
    expect(parseReviewOutput({ summary: "x", findings: [] })).toBeNull();
  });

  it("returns null when an enum value is invalid (corrupt row)", () => {
    expect(
      parseReviewOutput({ ...valid, findings: [{ ...valid.findings[0], severity: "boom" }] }),
    ).toBeNull();
    expect(parseReviewOutput({ ...valid, confidence: "very-high" })).toBeNull();
  });

  it("returns null for a non-object value", () => {
    expect(parseReviewOutput("not json")).toBeNull();
    expect(parseReviewOutput(42)).toBeNull();
  });
});
