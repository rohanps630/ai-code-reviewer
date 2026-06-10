/**
 * runReview — the agent loop entry point.
 *
 * ⚠️  PROTECTED FILE — see AGENTS.md § 7.
 *
 * ReAct-style loop:
 *
 *   user(diff) ─▶ provider.generate({ tools: [search_code, read_file,
 *                                              find_references, submit_review] })
 *                       │
 *                       ▼
 *                 emit text chunk as ReviewChunk.text event
 *                       │
 *                       ▼ response.toolCalls
 *                       │
 *               ┌───────┴────────────┐
 *               │                    │
 *      submit_review called?    other tool calls?
 *               │                    │
 *               ▼                    ▼
 *          emit `final`        emit tool_call/tool_result
 *          stop loop           events; append tool_result
 *                              messages; loop again
 *
 * Termination:
 *   - submit_review tool called  → success
 *   - MAX_ITERATIONS reached     → throw
 *   - COST_CAP_USD exceeded      → throw
 *   - Model produced no tools    → throw (it should have at minimum
 *                                  called submit_review)
 *
 * Provider:
 *   Any ModelProvider (Anthropic, OpenAI, Groq, etc.) can be injected
 *   via RunReviewDeps.provider. defaultDeps() resolves from env:
 *   ANTHROPIC_API_KEY → anthropic, GROQ_API_KEY → groq.
 *
 * Deps:
 *   `provider`, `retriever`, and `executor` are all injectable. The
 *   env-backed default builds them from `@acr/shared/env` +
 *   `@acr/db/client` + the hybrid retriever's `searchCode` factory.
 *
 * What the loop does NOT own:
 *   - Persistence — the route updates the reviews row from the
 *     ReviewChunk stream.
 *   - Langfuse tracing — the route wraps the stream in a span.
 *     The loop just emits semantic events.
 */

import { CURRENT_SYSTEM_PROMPT } from "./prompts/index.js";
import type { ModelMessage, ModelProvider, ToolSpec } from "./providers/index.js";
import { HybridRetriever, type SearchResult } from "./retrieval/index.js";
import {
  type JsonSchemaObject,
  type RunTestsSandboxFactory,
  buildToolRegistry,
  createFindReferencesTool,
  createReadFileTool,
  createRunTestsTool,
  createSearchCodeTool,
  defaultE2BFactory,
  executeToolCall,
} from "./tools/index.js";
import type { Finding, ReviewChunk, ReviewInput, ReviewOutput } from "./types.js";

// ────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────

import { PRICING_USD_PER_MTOK, resolveModelId } from "./models.js";

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
// submit_review sentinel — tightly coupled to the loop's termination
// logic, not a real executable tool.
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

const SUBMIT_REVIEW_TOOL: ToolSpec = {
  name: SUBMIT_REVIEW_NAME,
  description:
    "Submit the final structured review and stop. Call this exactly once " +
    "at the end of your reasoning, after you've gathered enough context " +
    "via the other tools. Do not produce text after calling this.",
  inputSchema: SUBMIT_REVIEW_INPUT_SCHEMA,
};

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

  // Build per-call tool registry.
  // why: Tool<SpecificIn, SpecificOut> is not assignable to Tool<unknown, unknown> due to
  // function-parameter contravariance — the cast is safe because buildToolRegistry only
  // reads name/description/inputSchema/inputValidator/outputValidator/execute at a widened
  // level and never calls execute with an unconstrained unknown.
  type WidenedTool = Parameters<typeof buildToolRegistry>[0][number];
  const tools: WidenedTool[] = [
    createSearchCodeTool(deps.retriever) as unknown as WidenedTool,
    createReadFileTool(deps.executor) as unknown as WidenedTool,
    createFindReferencesTool(deps.executor) as unknown as WidenedTool,
  ];
  if (deps.sandboxFactory) {
    tools.push(createRunTestsTool(deps.sandboxFactory) as unknown as WidenedTool);
  }
  const registry = buildToolRegistry(tools);

  const toolSpecs: ToolSpec[] = [
    ...[...registry.values()].map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
    SUBMIT_REVIEW_TOOL,
  ];

  const messages: ModelMessage[] = [{ role: "user", content: buildOpeningMessage(input) }];

  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;
  let iteration = 0;

  yield {
    type: "status",
    message: `Agent loop starting (provider=${deps.provider.provider}, model=${deps.provider.modelId}, max_iter=${maxIter}, cap=$${costCap})`,
  };

  while (iteration < maxIter) {
    iteration++;
    yield { type: "status", message: `Iteration ${iteration}/${maxIter}...` };

    const response = await deps.provider.generate({
      system: CURRENT_SYSTEM_PROMPT,
      messages,
      tools: toolSpecs,
      maxTokens: DEFAULT_MAX_TOKENS,
    });

    if (response.text) {
      yield { type: "text", delta: response.text };
    }

    totalInputTokens += response.usage.inputTokens;
    totalOutputTokens += response.usage.outputTokens;
    totalCacheReadTokens += response.usage.cacheReadTokens ?? 0;
    totalCacheCreationTokens += response.usage.cacheCreationTokens ?? 0;

    const pricing = PRICING_USD_PER_MTOK[deps.provider.modelId];
    if (!pricing) {
      console.warn(
        `[agent] No pricing data for model "${deps.provider.modelId}" — cost tracking disabled for this run.`,
      );
    }
    if (pricing) {
      const cacheRead = response.usage.cacheReadTokens ?? 0;
      const cacheWrite = response.usage.cacheCreationTokens ?? 0;
      const baseInput = response.usage.inputTokens - cacheRead - cacheWrite;

      const writeRate = pricing.input * 1.25;
      const readRate = pricing.input * 0.1;

      const stepCost =
        (baseInput / 1_000_000) * pricing.input +
        (cacheRead / 1_000_000) * readRate +
        (cacheWrite / 1_000_000) * writeRate +
        (response.usage.outputTokens / 1_000_000) * pricing.output;

      totalCostUsd += stepCost;
    }

    messages.push({
      role: "assistant",
      content: response.text,
      toolCalls: [...response.toolCalls],
    });

    // Did the model submit a review?
    const submitCall = response.toolCalls.find((tc) => tc.name === SUBMIT_REVIEW_NAME);
    if (submitCall) {
      const output = validateReviewOutput(submitCall.input);
      yield {
        type: "final",
        output,
        usage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          costUsd: totalCostUsd,
          cacheReadTokens: totalCacheReadTokens,
          cacheCreationTokens: totalCacheCreationTokens,
        },
      };
      return;
    }

    const toolUses = response.toolCalls.filter((tc) => tc.name !== SUBMIT_REVIEW_NAME);

    if (toolUses.length === 0) {
      throw new Error("Model ended turn without calling submit_review or any other tool");
    }

    for (const call of toolUses) {
      yield { type: "tool_call", name: call.name, input: call.input };
    }

    const results = await Promise.all(
      toolUses.map((call) =>
        executeToolCall(registry, { id: call.id, name: call.name, input: call.input }),
      ),
    );

    for (const result of results) {
      yield {
        type: "tool_result",
        name: result.name,
        output: result.ok ? result.output : { error: result.error },
      };
    }

    // Tool results are individual messages in the neutral format.
    for (const result of results) {
      messages.push({
        role: "tool",
        toolCallId: result.id,
        toolName: result.name,
        content: result.ok ? JSON.stringify(result.output) : result.error,
        isError: !result.ok,
      });
    }

    if (totalCostUsd >= costCap) {
      throw new Error(
        `Cost cap exceeded: $${totalCostUsd.toFixed(4)} >= $${costCap.toFixed(2)} after iteration ${iteration}`,
      );
    }
  }

  throw new Error(
    `MAX_ITERATIONS reached (${maxIter}) without submit_review. Cost: $${totalCostUsd.toFixed(4)}.`,
  );
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

const cachedDeps = new Map<string, RunReviewDeps>();

// Shared heavy resources (retriever, executor, sandbox) — built once,
// reused across all tiers so we only clone/embed/connect once per
// process lifetime.
let sharedRetriever: RetrieverLike | null = null;
let sharedExecutor: SqlExecutorLike | null = null;
let sharedSandboxFactory: RunTestsSandboxFactory | undefined;
let sharedResourcesLoaded = false;

async function ensureSharedResources(): Promise<{
  retriever: RetrieverLike;
  executor: SqlExecutorLike;
  sandboxFactory: RunTestsSandboxFactory | undefined;
}> {
  if (sharedResourcesLoaded && sharedRetriever && sharedExecutor) {
    return {
      retriever: sharedRetriever,
      executor: sharedExecutor,
      sandboxFactory: sharedSandboxFactory,
    };
  }

  const [{ serverEnv }, { db }] = await Promise.all([
    import("@acr/shared/env"),
    import("@acr/db/client"),
  ]).catch((err: unknown) => {
    throw new Error(
      `Failed to load required modules in defaultDeps: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  sharedExecutor = db as unknown as SqlExecutorLike;

  if (serverEnv.VOYAGE_API_KEY) {
    const { VoyageClient, CohereReranker } = await import("./retrieval/index.js");
    const embedder = new VoyageClient({ apiKey: serverEnv.VOYAGE_API_KEY });
    const reranker = serverEnv.COHERE_API_KEY
      ? new CohereReranker({ apiKey: serverEnv.COHERE_API_KEY })
      : undefined;
    sharedRetriever = new HybridRetriever({
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
    sharedRetriever = { search: async () => [] };
  }

  sharedSandboxFactory = serverEnv.E2B_API_KEY
    ? await defaultE2BFactory(serverEnv.E2B_API_KEY)
    : undefined;

  sharedResourcesLoaded = true;
  return {
    retriever: sharedRetriever,
    executor: sharedExecutor,
    sandboxFactory: sharedSandboxFactory,
  };
}

async function defaultDeps(tier: string): Promise<RunReviewDeps> {
  const existing = cachedDeps.get(tier);
  if (existing) return existing;

  const shared = await ensureSharedResources();

  const [{ serverEnv }] = await Promise.all([import("@acr/shared/env")]);

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

  const deps: RunReviewDeps = {
    provider,
    retriever: shared.retriever,
    executor: shared.executor,
    sandboxFactory: shared.sandboxFactory,
  };
  cachedDeps.set(tier, deps);
  return deps;
}

/** Reset cached deps. Tests only. */
export function _resetForTests(): void {
  cachedDeps.clear();
  sharedRetriever = null;
  sharedExecutor = null;
  sharedSandboxFactory = undefined;
  sharedResourcesLoaded = false;
}
