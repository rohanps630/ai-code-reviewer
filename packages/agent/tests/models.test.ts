import { describe, expect, it } from "vitest";
import { MODEL_TIERS, resolveModelId, resolveModelIdForEnv } from "../src/models.js";

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

describe("resolveModelIdForEnv (cache-key model id)", () => {
  it("resolves the concrete Anthropic model id for a tier", () => {
    expect(resolveModelIdForEnv("sonnet", { ANTHROPIC_API_KEY: "x" })).toBe(
      MODEL_TIERS.anthropic?.sonnet,
    );
  });

  it("follows the provider cascade (Groq when only Groq is set)", () => {
    expect(resolveModelIdForEnv("haiku", { GROQ_API_KEY: "x" })).toBe(MODEL_TIERS.groq?.haiku);
  });

  it("falls back to Ollama when no API keys are set", () => {
    expect(resolveModelIdForEnv("opus", {})).toBe(MODEL_TIERS.ollama?.opus);
  });

  it("agrees with resolveProviderForTier's model id (keys line up)", () => {
    // Both the route (id-only) and worker (full provider) must derive the same
    // id from the same tier+env, or cache writes never match reads.
    expect(resolveModelIdForEnv("opus", { ANTHROPIC_API_KEY: "x" })).toBe(
      MODEL_TIERS.anthropic?.opus,
    );
  });
});
