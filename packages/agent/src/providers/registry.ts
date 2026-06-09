/**
 * Model resolution — turn a bare model-id string into a `ModelProvider`.
 *
 * Lets callers write `new Agent({ model: "gemini-2.5-pro" })` (ADK style)
 * instead of always constructing a provider object. The provider is
 * inferred from the id prefix; pass a `ModelProvider` directly for full
 * control (custom client, apiKey, maxTokens).
 */

import { anthropic } from "./anthropic.js";
import { google } from "./google.js";
import { openai } from "./openai.js";
import type { ModelProvider } from "./types.js";

/** A model accepted by `Agent`: either a ready provider or a model-id
 *  string resolved by prefix. */
export type ModelLike = ModelProvider | string;

function isModelProvider(value: ModelLike): value is ModelProvider {
  return typeof value === "object" && value !== null && typeof value.generate === "function";
}

/**
 * Resolve a `ModelLike` to a concrete `ModelProvider`.
 *
 * Prefix routing:
 *   - `claude-*`                  → Anthropic
 *   - `gpt-*`, `o1*`, `o3*`, `o4*`→ OpenAI
 *   - `gemini-*`                  → Google
 *
 * String resolution uses the provider's env-based API key. For anything
 * non-default (injected client, explicit key), construct the provider
 * yourself and pass the object.
 */
export function resolveModel(model: ModelLike): ModelProvider {
  if (isModelProvider(model)) return model;

  const id = model.trim();
  if (/^claude-/.test(id)) return anthropic(id);
  if (/^(gpt-|o[1-4])/.test(id)) return openai(id);
  if (/^gemini-/.test(id)) return google(id);

  throw new Error(
    `Cannot infer a provider for model "${id}". Pass a provider object ` +
      `(e.g. anthropic("${id}"), openai("${id}"), google("${id}")) instead.`,
  );
}
