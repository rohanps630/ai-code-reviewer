/**
 * Model tier + pricing tables.
 *
 * Extracted from loop.ts (ADR-004) so both `runReview` and the `Agent`
 * runtime read one source. `MODEL_TIERS` + `resolveModelId` map a tier
 * label ("haiku" | "sonnet" | "opus") to a concrete model id per
 * provider; `PRICING_USD_PER_MTOK` + `getModelPricing` drive the cost cap.
 *
 * Pricing here is only for the in-loop spend cap. Langfuse owns real cost
 * accounting downstream.
 */

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

export function isTier(t: string): t is Tier {
  return t === "haiku" || t === "sonnet" || t === "opus";
}

export function resolveModelId(providerName: string, tier: string): string {
  const tiers = MODEL_TIERS[providerName];
  const safeTier: Tier = isTier(tier) ? tier : "sonnet";
  return tiers?.[safeTier] ?? "sonnet";
}

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

/** Pricing for a concrete model id, or `undefined` when unknown (caller
 *  disables cost tracking + the spend cap for that run). */
export function getModelPricing(modelId: string): { input: number; output: number } | undefined {
  return PRICING_USD_PER_MTOK[modelId];
}
