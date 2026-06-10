import { describe, expect, it } from "vitest";
import { MODEL_TIERS, resolveModelId } from "../src/models.js";

describe("resolveModelId", () => {
  it("resolves known provider + tier to the table entry", () => {
    expect(resolveModelId("anthropic", "sonnet")).toBe(MODEL_TIERS.anthropic?.sonnet);
    expect(resolveModelId("groq", "haiku")).toBe(MODEL_TIERS.groq?.haiku);
  });

  it("falls back to sonnet for unknown tier names", () => {
    expect(resolveModelId("anthropic", "mega")).toBe(MODEL_TIERS.anthropic?.sonnet);
  });

  it("throws for unknown provider names", () => {
    expect(() => resolveModelId("mistral", "sonnet")).toThrow(
      'Unknown provider "mistral" — no model tier table',
    );
  });
});
