/**
 * Model resolution and pricing tables.
 *
 * Extracted from loop.ts so the web route can resolve tier labels
 * ("haiku" | "sonnet" | "opus") to concrete model providers without
 * going through the loop's internal `defaultDeps`. The loop itself
 * imports from here to avoid duplication.
 *
 * resolveProviderForTier() replicates the provider-preference cascade
 * from defaultDeps() — ANTHROPIC → GROQ → OPENAI → GOOGLE → Ollama —
 * but is a pure function of (tier, env keys) with no side effects.
 */

import type { ModelProvider } from "./providers/index.js";

// ────────────────────────────────────────────────────────────────────
// Tier → concrete model ID table
// ────────────────────────────────────────────────────────────────────

export type Tier = "haiku" | "sonnet" | "opus";

/** Model IDs per provider + tier. Add a row when onboarding a new
 *  provider; defaultDeps() picks the right column from env. */
export const MODEL_TIERS: Record<string, Record<Tier, string>> = {
  anthropic: {
    haiku: "claude-haiku-4-5",
    sonnet: "claude-sonnet-4-7",
    opus: "claude-opus-4-7",
  },
  groq: {
    haiku: "llama-3.1-8b-instant",
    sonnet: "llama-3.3-70b-versatile",
    opus: "llama-3.3-70b-versatile",
  },
  openai: {
    haiku: "gpt-4o-mini",
    sonnet: "gpt-4o",
    opus: "gpt-4o",
  },
  google: {
    haiku: "gemini-2.0-flash-lite",
    sonnet: "gemini-2.5-flash",
    opus: "gemini-2.5-pro",
  },
  ollama: {
    haiku: "qwen3.5:latest",
    sonnet: "gemma4:e4b",
    opus: "deepseek-r1:14b",
  },
} as const;

export function resolveModelId(providerName: string, tier: string): string {
  const tiers = MODEL_TIERS[providerName];
  if (!tiers) {
    throw new Error(`Unknown provider "${providerName}" — no model tier table`);
  }
  const isTier = (t: string): t is Tier => t === "haiku" || t === "sonnet" || t === "opus";
  const safeTier: Tier = isTier(tier) ? tier : "sonnet";
  return tiers[safeTier];
}

// ────────────────────────────────────────────────────────────────────
// Per-million-token pricing (USD)
// ────────────────────────────────────────────────────────────────────

/** Per-million-token pricing (USD). Used only for the cost cap —
 *  Langfuse handles real cost accounting downstream. */
export const PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-7": { input: 3.0, output: 15.0 },
  "claude-opus-4-7": { input: 15.0, output: 75.0 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  // Local inference — no marginal cost
  "qwen3.5:latest": { input: 0, output: 0 },
  "deepseek-r1:14b": { input: 0, output: 0 },
  "gemma4:e4b": { input: 0, output: 0 },
};

// ────────────────────────────────────────────────────────────────────
// Tier → ModelProvider (for route-level resolution)
// ────────────────────────────────────────────────────────────────────

/**
 * Env shape expected by resolveProviderForTier.
 * Matches the subset of `serverEnv` that controls provider selection.
 */
export type ProviderEnvKeys = {
  ANTHROPIC_API_KEY?: string;
  GROQ_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  OLLAMA_BASE_URL?: string;
};

/**
 * Resolve a tier label to a concrete ModelProvider using the same
 * preference cascade as `defaultDeps()` in loop.ts:
 *   ANTHROPIC_API_KEY → GROQ → OPENAI → GOOGLE → Ollama fallback.
 *
 * This is a synchronous function — provider constructors are cheap
 * (no network calls). The route can call this directly instead of
 * going through `resolveModel` (which expects model-ID strings).
 */
export async function resolveProviderForTier(
  tier: string,
  envKeys: ProviderEnvKeys,
): Promise<ModelProvider> {
  const { anthropic, groq, openai, google, ollama } = await import("./providers/index.js");

  const isTier = (t: string): t is Tier => t === "haiku" || t === "sonnet" || t === "opus";
  const safeTier = isTier(tier) ? tier : "sonnet";

  if (envKeys.ANTHROPIC_API_KEY) {
    return anthropic(resolveModelId("anthropic", safeTier));
  }
  if (envKeys.GROQ_API_KEY) {
    return groq(resolveModelId("groq", safeTier));
  }
  if (envKeys.OPENAI_API_KEY) {
    return openai(resolveModelId("openai", safeTier));
  }
  if (envKeys.GOOGLE_API_KEY) {
    return google(resolveModelId("google", safeTier));
  }
  // Local Ollama — no API key required
  return ollama(resolveModelId("ollama", safeTier), {
    baseURL: envKeys.OLLAMA_BASE_URL,
  });
}
