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

const MAX_ITERATIONS = 10;
const COST_CAP_USD = 0.5;
const DEFAULT_MAX_TOKENS = 4096;

type Tier = "haiku" | "sonnet" | "opus";

/** Model IDs per provider + tier. Add a row when onboarding a new
 *  provider; defaultDeps() picks the right column from env. */
const MODEL_TIERS: Record<string, Record<Tier, string>> = {
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
} as const;

function resolveModelId(providerName: string, tier: string): string {
  const tiers = MODEL_TIERS[providerName];
  const isTier = (t: string): t is Tier => t === "haiku" || t === "sonnet" || t === "opus";
  const safeTier: Tier = isTier(tier) ? tier : "sonnet";
  return tiers?.[safeTier] ?? "sonnet";
}

/** Per-million-token pricing (USD). Used only for the cost cap —
 *  Langfuse handles real cost accounting downstream. */
const PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-7": { input: 3.0, output: 15.0 },
  "claude-opus-4-7": { input: 15.0, output: 75.0 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
};

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

export async function* runReview(
  input: ReviewInput,
  deps?: RunReviewDeps,
): AsyncGenerator<ReviewChunk, void, void> {
  const resolved = deps ?? (await defaultDeps(input.model ?? "sonnet"));
  yield* runReviewWithDeps(input, resolved);
}

async function* runReviewWithDeps(
  input: ReviewInput,
  deps: RunReviewDeps,
): AsyncGenerator<ReviewChunk, void, void> {
  const maxIter = deps.maxIterations ?? MAX_ITERATIONS;
  const costCap = deps.costCapUsd ?? COST_CAP_USD;

  // Build per-call tool registry.
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

    const pricing = PRICING_USD_PER_MTOK[deps.provider.modelId];
    if (pricing) {
      totalCostUsd +=
        (response.usage.inputTokens / 1_000_000) * pricing.input +
        (response.usage.outputTokens / 1_000_000) * pricing.output;
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
      yield { type: "final", output };
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

export function buildOpeningMessage(input: ReviewInput): string {
  const repoCtx = input.repoContext
    ? `\nRepo: ${input.repoContext.owner}/${input.repoContext.repo} (branch: ${input.repoContext.defaultBranch})\n`
    : "";
  return `Review the following diff. Use the available tools to gather context as needed. When you have enough information, call \`submit_review\` with your final findings.\n${repoCtx}\n<diff>\n${input.diff}\n</diff>`;
}

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
  if (typeof obj.confidence !== "string") {
    throw new Error("submit_review.input.confidence must be a string");
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
  ]);

  const { anthropic, groq, openai, google } = await import("./providers/index.js");

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
    throw new Error(
      "No LLM provider configured. Set one of: ANTHROPIC_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY.",
    );
  }

  if (!serverEnv.VOYAGE_API_KEY) {
    throw new Error("VOYAGE_API_KEY is not set — required for retrieval");
  }

  const { VoyageClient, CohereReranker } = await import("./retrieval/index.js");
  const embedder = new VoyageClient({ apiKey: serverEnv.VOYAGE_API_KEY });
  const reranker = serverEnv.COHERE_API_KEY
    ? new CohereReranker({ apiKey: serverEnv.COHERE_API_KEY })
    : undefined;
  const retriever = new HybridRetriever({
    embedder,
    executor: db as unknown as SqlExecutorLike,
    reranker,
  });

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
