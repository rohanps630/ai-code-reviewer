import { resolveProviderForTier } from "@acr/agent";
import type { ProviderEnvKeys } from "@acr/agent";
import { describe, expect, it } from "vitest";

/**
 * Non-mocked route test: validates that resolveProviderForTier
 * correctly resolves tier labels to concrete model providers.
 *
 * This test uses the REAL function (not mocked) to prove the bug
 * path — where `resolveModel(selectedModel)` threw for tier names
 * like "sonnet" — no longer fails.
 */
describe("resolveProviderForTier (real, not mocked)", () => {
  const MOCK_ENV: ProviderEnvKeys = {
    ANTHROPIC_API_KEY: "sk-ant-test-key",
  };

  it("resolves 'sonnet' to an Anthropic model provider", async () => {
    const provider = await resolveProviderForTier("sonnet", MOCK_ENV);
    expect(provider).toBeDefined();
    expect(provider.provider).toBe("anthropic");
    expect(provider.modelId).toBe("claude-sonnet-4-6");
    expect(typeof provider.generate).toBe("function");
  });

  it("resolves 'haiku' to Haiku model ID", async () => {
    const provider = await resolveProviderForTier("haiku", MOCK_ENV);
    expect(provider.modelId).toBe("claude-haiku-4-5-20251001");
  });

  it("resolves 'opus' to Opus model ID", async () => {
    const provider = await resolveProviderForTier("opus", MOCK_ENV);
    expect(provider.modelId).toBe("claude-opus-4-8");
  });

  it("falls back to sonnet for unknown tier strings", async () => {
    const provider = await resolveProviderForTier("unknown-tier", MOCK_ENV);
    expect(provider.modelId).toBe("claude-sonnet-4-6");
  });

  it("selects Groq when only GROQ_API_KEY is set", async () => {
    const env: ProviderEnvKeys = { GROQ_API_KEY: "gsk-test" };
    const provider = await resolveProviderForTier("sonnet", env);
    expect(provider.provider).toBe("groq");
    expect(provider.modelId).toBe("llama-3.3-70b-versatile");
  });

  it("selects OpenAI when only OPENAI_API_KEY is set", async () => {
    const env: ProviderEnvKeys = { OPENAI_API_KEY: "sk-test" };
    const provider = await resolveProviderForTier("haiku", env);
    expect(provider.provider).toBe("openai");
    expect(provider.modelId).toBe("gpt-4o-mini");
  });

  it("falls back to Ollama when no API keys are set", async () => {
    const provider = await resolveProviderForTier("sonnet", {});
    expect(provider.provider).toBe("ollama");
  });
});
