/**
 * runReview — the code-review agent loop entry point.
 *
 * ⚠️  PROTECTED FILE — see docs/guidelines.md § 7.
 *
 * As of ADR-004 this is a thin **specialization of the `Agent` runtime**
 * (agent.ts), not a hand-rolled loop. `runReview` configures one `Agent`:
 *
 *   - systemPrompt = CURRENT_SYSTEM_PROMPT (protected)
 *   - tools        = the registry-built review tools (search_code, read_file,
 *                    find_references, and run_tests when a sandbox is wired)
 *   - stopTool     = submit_review, validated by `validateReviewOutput`
 *   - pricing      = models.ts table, keyed by the provider's model id
 *   - costCap / maxIterations = from deps (env-backed defaults otherwise)
 *
 * It then maps the runtime's `AgentEvent`s onto the public `ReviewChunk`
 * stream and translates the runtime's typed errors back to this loop's
 * historical error messages. The public surface — `runReview`'s signature,
 * the `ReviewChunk` sequence, and every error message/type — is unchanged.
 *
 * Termination (unchanged semantics):
 *   - submit_review called      → `final` chunk, success
 *   - MAX_ITERATIONS reached     → throw
 *   - COST_CAP_USD exceeded      → throw
 *   - model produced no tools    → throw (it must at least call submit_review)
 *
 * Provider / deps: `provider`, `retriever`, and `executor` are injectable;
 * `defaultDeps()` builds them from `@acr/shared/env` + `@acr/db/client`.
 *
 * What the loop does NOT own: persistence (the route updates the reviews row
 * from the chunk stream) and Langfuse tracing (the route wraps the stream).
 */

import {
  Agent,
  AgentCostCapError,
  AgentMaxIterationsError,
  AgentNoStopToolError,
  AgentStopToolValidationError,
} from "./agent.js";
import type { AgentTool } from "./agent.js";
import { getModelPricing, resolveModelId } from "./models.js";
import { CURRENT_SYSTEM_PROMPT } from "./prompts/index.js";
import type { ModelProvider } from "./providers/index.js";
import { HybridRetriever, type SearchResult } from "./retrieval/index.js";
import {
  type JsonSchemaObject,
  type RunTestsSandboxFactory,
  createFindReferencesTool,
  createReadFileTool,
  createRunTestsTool,
  createSearchCodeTool,
  defaultE2BFactory,
} from "./tools/index.js";
import type { Finding, ReviewChunk, ReviewInput, ReviewOutput } from "./types.js";

// ────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 10;
const COST_CAP_USD = 0.5;
const DEFAULT_MAX_TOKENS = 4096;

// ────────────────────────────────────────────────────────────────────
// Dep contracts
// ────────────────────────────────────────────────────────────────────

export interface RetrieverLike {
  search: (query: string, options?: { repoId?: string; limit?: number }) => Promise<SearchResult[]>;
}

export interface SqlExecutorLike {
  execute: (query: unknown) => Promise<unknown>;
}

export type RunReviewDeps = {
  /** Any ModelProvider — Anthropic, Groq, OpenAI, Google, or custom. */
  provider: ModelProvider;
  retriever: RetrieverLike;
  executor: SqlExecutorLike;
  /** Optional E2B-style sandbox factory for the run_tests tool.
   *  When omitted, run_tests is simply not registered. */
  sandboxFactory?: RunTestsSandboxFactory;
  /** Optional overrides — handy for evals + tests. */
  maxIterations?: number;
  costCapUsd?: number;
};

// ────────────────────────────────────────────────────────────────────
// submit_review sentinel — the Agent stop tool. Appended to the model's
// tool specs, validated by validateReviewOutput, and never executed.
// ────────────────────────────────────────────────────────────────────

const SUBMIT_REVIEW_NAME = "submit_review";

const SUBMIT_REVIEW_INPUT_SCHEMA: JsonSchemaObject = {
  type: "object",
  required: ["summary", "findings", "confidence"],
  properties: {
    summary: {
      type: "string",
      description: "One-paragraph summary of the change and review.",
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["category", "severity", "summary"],
        properties: {
          category: { type: "string", enum: ["bug", "perf", "security", "style", "logic"] },
          severity: { type: "string", enum: ["critical", "major", "minor"] },
          summary: { type: "string" },
          locationHint: {
            type: "string",
            description: "path:start-end, e.g. src/auth/login.ts:42-58",
          },
          suggestion: { type: "string" },
        },
      },
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
};

const SUBMIT_REVIEW_DESCRIPTION =
  "Submit the final structured review and stop. Call this exactly once " +
  "at the end of your reasoning, after you've gathered enough context " +
  "via the other tools. Do not produce text after calling this.";

// ────────────────────────────────────────────────────────────────────
// runReview — async-generator entry point
// ────────────────────────────────────────────────────────────────────

/**
 * Heuristic-based model router.
 * Routes based on diff size, files changed, and public API modifications.
 */
export function routeModel(diff: string): "haiku" | "sonnet" | "opus" {
  const lines = diff.split("\n");
  const totalLines = lines.length;

  // Count changed files
  const fileHeaders = lines.filter((line) => line.startsWith("diff --git "));
  const filesChanged = fileHeaders.length || 1;

  // Check for public API surface changes
  let hasApiSurfaceChange = false;
  const apiPatterns = [
    /^\+\s*export\s+/, // TypeScript/JavaScript exports
    /^\+\s*(pub\s+)?(fn|struct|enum|trait|type)\s+/, // Go/Rust public types/functions
    /^\+\s*(def|class)\s+[a-zA-Z0-9_]/, // Python classes/functions
  ];

  for (const line of lines) {
    if (apiPatterns.some((pattern) => pattern.test(line))) {
      hasApiSurfaceChange = true;
      break;
    }
  }

  // Trivial: < 50 lines, 1 file, no API surface changes
  if (totalLines < 50 && filesChanged === 1 && !hasApiSurfaceChange) {
    return "haiku";
  }

  // Complex: > 500 lines or > 5 files changed
  if (totalLines > 500 || filesChanged > 5) {
    return "opus";
  }

  // Standard: otherwise
  return "sonnet";
}

export async function* runReview(
  input: ReviewInput,
  deps?: RunReviewDeps,
): AsyncGenerator<ReviewChunk, void, void> {
  const resolvedModel =
    !input.model || input.model === "auto" ? routeModel(input.diff) : input.model;

  const resolvedInput = {
    ...input,
    model: resolvedModel,
  };

  const resolved = deps ?? (await defaultDeps(resolvedModel));
  yield* runReviewWithDeps(resolvedInput, resolved);
}

async function* runReviewWithDeps(
  input: ReviewInput,
  deps: RunReviewDeps,
): AsyncGenerator<ReviewChunk, void, void> {
  const maxIter = deps.maxIterations ?? MAX_ITERATIONS;
  const costCap = deps.costCapUsd ?? COST_CAP_USD;

  // The review tool set. Tool<SpecificIn, SpecificOut> is the covariant
  // source of the public AgentTool shape; the Agent's registry only reads
  // name/description/schema/validators/execute, so the cast is safe.
  const tools: AgentTool[] = [
    createSearchCodeTool(deps.retriever) as unknown as AgentTool,
    createReadFileTool(deps.executor) as unknown as AgentTool,
    createFindReferencesTool(deps.executor) as unknown as AgentTool,
  ];
  if (deps.sandboxFactory) {
    tools.push(createRunTestsTool(deps.sandboxFactory) as unknown as AgentTool);
  }

  const agent = new Agent({
    model: deps.provider,
    systemPrompt: CURRENT_SYSTEM_PROMPT,
    tools,
    maxIterations: maxIter,
    maxTokens: DEFAULT_MAX_TOKENS,
    pricing: getModelPricing(deps.provider.modelId),
    costCapUsd: costCap,
    stopTool: {
      name: SUBMIT_REVIEW_NAME,
      description: SUBMIT_REVIEW_DESCRIPTION,
      inputSchema: SUBMIT_REVIEW_INPUT_SCHEMA,
      validate: validateReviewOutput,
    },
  });

  yield {
    type: "status",
    message: `Agent loop starting (provider=${deps.provider.provider}, model=${deps.provider.modelId}, max_iter=${maxIter}, cap=$${costCap})`,
  };

  try {
    for await (const ev of agent.stream(buildOpeningMessage(input))) {
      switch (ev.type) {
        case "model_call_start":
          yield { type: "status", message: `Iteration ${ev.iteration}/${maxIter}...` };
          break;
        case "model_response":
          if (ev.text) yield { type: "text", delta: ev.text };
          break;
        case "tool_call":
          yield { type: "tool_call", name: ev.name, input: ev.input };
          break;
        case "tool_result":
          // Errors surface to the model as { error }, exactly as before.
          yield {
            type: "tool_result",
            name: ev.name,
            output: ev.isError ? { error: ev.output } : ev.output,
          };
          break;
        case "final":
          yield {
            type: "final",
            output: ev.stopToolInput as ReviewOutput,
            usage: {
              inputTokens: ev.usage.inputTokens,
              outputTokens: ev.usage.outputTokens,
              costUsd: ev.usage.costUsd,
              cacheReadTokens: ev.usage.cacheReadTokens,
              cacheCreationTokens: ev.usage.cacheCreationTokens,
            },
          };
          break;
        // run_start / run_error carry no review-stream meaning — the
        // subsequent throw (if any) is translated below.
      }
    }
  } catch (err) {
    throw translateRuntimeError(err);
  }
}

/**
 * Map the `Agent` runtime's typed errors back to this loop's historical
 * error messages/types, so callers and tests see no behavioral change.
 */
function translateRuntimeError(err: unknown): unknown {
  if (err instanceof AgentCostCapError) {
    return new Error(
      `Cost cap exceeded: $${err.costUsd.toFixed(4)} >= $${err.capUsd.toFixed(2)} after iteration ${err.iteration}`,
    );
  }
  if (err instanceof AgentMaxIterationsError) {
    return new Error(
      `MAX_ITERATIONS reached (${err.iterations}) without submit_review. Cost: $${err.usage.costUsd.toFixed(4)}.`,
    );
  }
  if (err instanceof AgentNoStopToolError) {
    return new Error("Model ended turn without calling submit_review or any other tool");
  }
  if (err instanceof AgentStopToolValidationError) {
    // Preserve the exact validateReviewOutput message.
    return err.cause instanceof Error ? err.cause : new Error(String(err.cause ?? err.message));
  }
  return err;
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Escapes closing/opening tags of sensitive system delimiters in untrusted user-supplied
 * inputs to prevent prompt injection.
 */
export function sanitizeUntrustedText(text: string): string {
  if (!text) return "";
  return text.replace(
    /<(\/?)(diff|untrusted_file_content|untrusted_chunk)(?:\s+[^>]*)?>/gi,
    (match, slash, tagName) => {
      const attrs = match.includes(" ") ? match.slice(match.indexOf(" "), -1) : "";
      return `&lt;${slash || ""}${tagName}${attrs}&gt;`;
    },
  );
}

export function buildOpeningMessage(input: ReviewInput): string {
  const repoCtx = input.repoContext
    ? `\nRepo: ${input.repoContext.owner}/${input.repoContext.repo} (branch: ${input.repoContext.defaultBranch})\n`
    : "";
  return `Review the following diff. Use the available tools to gather context as needed. When you have enough information, call \`submit_review\` with your final findings.\n${repoCtx}\n<diff>\n${sanitizeUntrustedText(input.diff)}\n</diff>`;
}

const VALID_CATEGORIES = ["bug", "perf", "security", "style", "logic"] as const;
const VALID_SEVERITIES = ["critical", "major", "minor"] as const;
const VALID_CONFIDENCES = ["high", "medium", "low"] as const;

/** Light runtime guard on the model's submit_review input. */
export function validateReviewOutput(raw: unknown): ReviewOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("submit_review returned a non-object input");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.summary !== "string") {
    throw new Error("submit_review.input.summary must be a string");
  }
  if (!Array.isArray(obj.findings)) {
    throw new Error("submit_review.input.findings must be an array");
  }
  if (
    typeof obj.confidence !== "string" ||
    !VALID_CONFIDENCES.includes(obj.confidence as (typeof VALID_CONFIDENCES)[number])
  ) {
    throw new Error(
      `submit_review.input.confidence must be one of: ${VALID_CONFIDENCES.join(", ")}`,
    );
  }
  for (const [i, finding] of obj.findings.entries()) {
    if (!finding || typeof finding !== "object") {
      throw new Error(`submit_review.input.findings[${i}] must be an object`);
    }
    const f = finding as Record<string, unknown>;
    if (
      typeof f.category !== "string" ||
      !VALID_CATEGORIES.includes(f.category as (typeof VALID_CATEGORIES)[number])
    ) {
      throw new Error(
        `submit_review.input.findings[${i}].category must be one of: ${VALID_CATEGORIES.join(", ")}`,
      );
    }
    if (
      typeof f.severity !== "string" ||
      !VALID_SEVERITIES.includes(f.severity as (typeof VALID_SEVERITIES)[number])
    ) {
      throw new Error(
        `submit_review.input.findings[${i}].severity must be one of: ${VALID_SEVERITIES.join(", ")}`,
      );
    }
    if (typeof f.summary !== "string") {
      throw new Error(`submit_review.input.findings[${i}].summary must be a string`);
    }
  }
  return {
    summary: obj.summary,
    findings: obj.findings as Finding[],
    confidence: obj.confidence as ReviewOutput["confidence"],
  };
}

// ────────────────────────────────────────────────────────────────────
// Env-backed defaults
// ────────────────────────────────────────────────────────────────────

let cachedDeps: RunReviewDeps | null = null;

async function defaultDeps(tier: string): Promise<RunReviewDeps> {
  if (cachedDeps) return cachedDeps;

  const [{ serverEnv }, { db }] = await Promise.all([
    import("@acr/shared/env"),
    import("@acr/db/client"),
  ]).catch((err: unknown) => {
    throw new Error(
      `Failed to load required modules in defaultDeps: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  const { anthropic, groq, openai, google, ollama } = await import("./providers/index.js").catch(
    (err: unknown) => {
      throw new Error(
        `Failed to load providers: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  );

  let provider: ModelProvider;

  if (serverEnv.ANTHROPIC_API_KEY) {
    provider = anthropic(resolveModelId("anthropic", tier));
  } else if (serverEnv.GROQ_API_KEY) {
    provider = groq(resolveModelId("groq", tier));
  } else if (serverEnv.OPENAI_API_KEY) {
    provider = openai(resolveModelId("openai", tier));
  } else if (serverEnv.GOOGLE_API_KEY) {
    provider = google(resolveModelId("google", tier));
  } else {
    // Local Ollama — no API key required
    provider = ollama(resolveModelId("ollama", tier), {
      baseURL: serverEnv.OLLAMA_BASE_URL,
    });
  }

  let retriever: RetrieverLike;
  if (serverEnv.VOYAGE_API_KEY) {
    const { VoyageClient, CohereReranker } = await import("./retrieval/index.js");
    const embedder = new VoyageClient({ apiKey: serverEnv.VOYAGE_API_KEY });
    const reranker = serverEnv.COHERE_API_KEY
      ? new CohereReranker({ apiKey: serverEnv.COHERE_API_KEY })
      : undefined;
    retriever = new HybridRetriever({
      embedder,
      executor: db as unknown as SqlExecutorLike,
      reranker,
    });
  } else {
    // No VOYAGE_API_KEY — use a no-op retriever (evals / local runs without a real index).
    // All searches return empty results; RAG context will be absent from reviews.
    console.warn(
      "[agent] VOYAGE_API_KEY not set — retrieval is disabled. All search queries will return empty results.",
    );
    retriever = { search: async () => [] };
  }

  const sandboxFactory: RunTestsSandboxFactory | undefined = serverEnv.E2B_API_KEY
    ? await defaultE2BFactory(serverEnv.E2B_API_KEY)
    : undefined;

  cachedDeps = {
    provider,
    retriever,
    executor: db as unknown as SqlExecutorLike,
    sandboxFactory,
  };
  return cachedDeps;
}

/** Reset cached deps. Tests only. */
export function _resetForTests(): void {
  cachedDeps = null;
}
