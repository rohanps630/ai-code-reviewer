/**
 * runReview — the agent loop entry point.
 *
 * ⚠️  PROTECTED FILE — see AGENTS.md § 7.
 *
 * ReAct-style loop:
 *
 *   user(diff) ─▶ Claude.stream({ tools: [search_code, read_file,
 *                                          find_references, submit_review] })
 *                       │
 *                       ▼
 *                 emit text deltas as ReviewChunk.text events
 *                       │
 *                       ▼ finalMessage()
 *                       │
 *               ┌───────┴────────────┐
 *               │                    │
 *      submit_review called?    other tool calls?
 *               │                    │
 *               ▼                    ▼
 *          emit `final`        emit tool_call/tool_result
 *          stop loop           events; append tool_result
 *                              content; loop again
 *
 * Termination:
 *   - submit_review tool called  → success
 *   - MAX_ITERATIONS reached     → throw
 *   - COST_CAP_USD exceeded      → throw
 *   - Model produced no tools    → throw (it should have at minimum
 *                                  called submit_review)
 *
 * Deps:
 *   `anthropic.messages.stream`, `retriever.search`, and
 *   `executor.execute(sql)` are all injectable. The env-backed
 *   default builds them from `@acr/shared/env` + `@acr/db/client` +
 *   the hybrid retriever's `searchCode` factory.
 *
 * What the loop does NOT own:
 *   - Persistence — the route updates the reviews row from the
 *     ReviewChunk stream.
 *   - Langfuse tracing — the route wraps the stream in a span.
 *     The loop just emits semantic events.
 */

import Anthropic from "@anthropic-ai/sdk";

import { CURRENT_SYSTEM_PROMPT } from "./prompts/index.js";
import { HybridRetriever, type SearchResult } from "./retrieval/index.js";
import {
  type AnthropicTool,
  type JsonSchemaObject,
  type RunTestsSandboxFactory,
  buildToolRegistry,
  createFindReferencesTool,
  createReadFileTool,
  createRunTestsTool,
  createSearchCodeTool,
  defaultE2BFactory,
  executeToolCall,
  toAnthropicTools,
} from "./tools/index.js";
import type { Finding, ReviewChunk, ReviewInput, ReviewOutput } from "./types.js";

// ────────────────────────────────────────────────────────────────────
// Configuration — defaults; deps can override per-call later
// ────────────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 10;
const COST_CAP_USD = 0.5;
const DEFAULT_MAX_TOKENS = 4096;

const MODEL_IDS = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-7",
  opus: "claude-opus-4-7",
} as const;

/** Per-million-token pricing (USD). Rough 2026 figures; bump these
 *  alongside an ADR if Anthropic changes prices. Used only for the
 *  cost cap — Langfuse handles real cost accounting downstream. */
const PRICING_PER_MTOK: Record<keyof typeof MODEL_IDS, { input: number; output: number }> = {
  haiku: { input: 1.0, output: 5.0 },
  sonnet: { input: 3.0, output: 15.0 },
  opus: { input: 15.0, output: 75.0 },
};

// ────────────────────────────────────────────────────────────────────
// Dep contracts
// ────────────────────────────────────────────────────────────────────

export type AnthropicStreamFn = Anthropic["messages"]["stream"];

export interface RetrieverLike {
  search: (query: string, options?: { repoId?: string; limit?: number }) => Promise<SearchResult[]>;
}

export interface SqlExecutorLike {
  execute: (query: unknown) => Promise<unknown>;
}

export type RunReviewDeps = {
  stream: AnthropicStreamFn;
  retriever: RetrieverLike;
  executor: SqlExecutorLike;
  /** Optional E2B-style sandbox factory for the run_tests tool.
   *  When omitted, run_tests is simply not registered — the model
   *  loses access to it but the rest of the loop still works. */
  sandboxFactory?: RunTestsSandboxFactory;
  /** Optional overrides — handy for evals + tests. */
  maxIterations?: number;
  costCapUsd?: number;
};

// ────────────────────────────────────────────────────────────────────
// submit_review sentinel — defined here (not in tools/) because it's
// tightly coupled to the loop's termination logic, not a real
// executable tool.
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

const SUBMIT_REVIEW_TOOL: AnthropicTool = {
  name: SUBMIT_REVIEW_NAME,
  description:
    "Submit the final structured review and stop. Call this exactly once " +
    "at the end of your reasoning, after you've gathered enough context " +
    "via the other tools. Do not produce text after calling this.",
  input_schema: SUBMIT_REVIEW_INPUT_SCHEMA,
};

// ────────────────────────────────────────────────────────────────────
// runReview — async-generator entry point
// ────────────────────────────────────────────────────────────────────

export async function* runReview(
  input: ReviewInput,
  deps?: RunReviewDeps,
): AsyncGenerator<ReviewChunk, void, void> {
  const resolved = deps ?? (await defaultDeps());
  yield* runReviewWithDeps(input, resolved);
}

async function* runReviewWithDeps(
  input: ReviewInput,
  deps: RunReviewDeps,
): AsyncGenerator<ReviewChunk, void, void> {
  const maxIter = deps.maxIterations ?? MAX_ITERATIONS;
  const costCap = deps.costCapUsd ?? COST_CAP_USD;
  const modelLabel = input.model ?? "sonnet";
  const modelId = MODEL_IDS[modelLabel];

  // Build per-call tool registry — keeps deps explicit and tests easy.
  // Cast widens the concrete Tool<TInput,TOutput> generics; TS doesn't
  // do this automatically because Tool is contravariant in its input.
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
  const anthropicTools: AnthropicTool[] = [...toAnthropicTools(registry), SUBMIT_REVIEW_TOOL];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildOpeningMessage(input) },
  ];

  let totalCostUsd = 0;
  let iteration = 0;

  yield {
    type: "status",
    message: `Agent loop starting (model=${modelLabel}, max_iter=${maxIter}, cap=$${costCap})`,
  };

  while (iteration < maxIter) {
    iteration++;
    yield { type: "status", message: `Iteration ${iteration}/${maxIter}...` };

    const stream = deps.stream({
      model: modelId,
      max_tokens: DEFAULT_MAX_TOKENS,
      system: CURRENT_SYSTEM_PROMPT,
      tools: anthropicTools as Anthropic.Tool[],
      messages,
    });

    // Stream text deltas as ReviewChunks; tool-call args (input_json_delta)
    // are structured output we don't expose mid-stream.
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta" &&
        event.delta.text
      ) {
        yield { type: "text", delta: event.delta.text };
      }
    }

    const message = await stream.finalMessage();
    totalCostUsd += costOfMessage(modelLabel, message);

    // Persist the model's turn in conversation history so the next
    // iteration sees it. The SDK's content blocks are the right shape
    // to ship straight back as an assistant param.
    messages.push({
      role: "assistant",
      content: message.content as Anthropic.ContentBlockParam[],
    });

    // Did the model submit a review? If so, we're done.
    const submitBlock = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === SUBMIT_REVIEW_NAME,
    );
    if (submitBlock) {
      const output = validateReviewOutput(submitBlock.input);
      yield { type: "final", output };
      return;
    }

    // Other tool calls? Execute them, ship results back, loop.
    const toolUses = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name !== SUBMIT_REVIEW_NAME,
    );

    if (toolUses.length === 0) {
      throw new Error("Model ended turn without calling submit_review or any other tool");
    }

    // Emit tool_call events up front so the UI can show "Searching
    // for X..." live while we execute.
    for (const call of toolUses) {
      yield { type: "tool_call", name: call.name, input: call.input };
    }

    const results = await Promise.all(
      toolUses.map((call) =>
        executeToolCall(registry, {
          id: call.id,
          name: call.name,
          input: call.input,
        }),
      ),
    );

    for (const result of results) {
      yield {
        type: "tool_result",
        name: result.name,
        output: result.ok ? result.output : { error: result.error },
      };
    }

    messages.push({
      role: "user",
      content: results.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.id,
        content: r.ok ? JSON.stringify(r.output) : r.error,
        is_error: !r.ok,
      })),
    });

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

export function buildOpeningMessage(input: ReviewInput): Anthropic.ContentBlockParam[] {
  const repoCtx = input.repoContext
    ? `\nRepo: ${input.repoContext.owner}/${input.repoContext.repo} ` +
      `(branch: ${input.repoContext.defaultBranch})\n`
    : "";
  return [
    {
      type: "text",
      text: `Review the following diff. Use the available tools to gather context as needed. When you have enough information, call \`submit_review\` with your final findings.\n${repoCtx}\n<diff>\n${input.diff}\n</diff>`,
    },
  ];
}

export function costOfMessage(model: keyof typeof MODEL_IDS, message: Anthropic.Message): number {
  const usage = message.usage;
  const pricing = PRICING_PER_MTOK[model];
  const inputUsd = (usage.input_tokens / 1_000_000) * pricing.input;
  const outputUsd = (usage.output_tokens / 1_000_000) * pricing.output;
  // Cache-read and cache-creation tokens (when prompt caching kicks in)
  // are priced differently. v1 ignores them; cost cap is conservative
  // enough that overestimating uncached input is safe.
  return inputUsd + outputUsd;
}

/** Light runtime guard on the model's submit_review input. The tool's
 *  JSON Schema enforces shape at the Anthropic side; this is belt to
 *  that suspenders so structural surprises fail loud before they hit
 *  downstream code. */
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

async function defaultDeps(): Promise<RunReviewDeps> {
  if (cachedDeps) return cachedDeps;

  const [{ serverEnv }, { db }] = await Promise.all([
    import("@acr/shared/env"),
    import("@acr/db/client"),
  ]);
  if (!serverEnv.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — required for runReview()");
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

  const anthropic = new Anthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY });
  // E2B is optional — missing the key just disables run_tests rather
  // than failing the whole loop.
  const sandboxFactory: RunTestsSandboxFactory | undefined = serverEnv.E2B_API_KEY
    ? await defaultE2BFactory(serverEnv.E2B_API_KEY)
    : undefined;
  cachedDeps = {
    stream: ((args: Anthropic.MessageStreamParams) =>
      anthropic.messages.stream(args)) as AnthropicStreamFn,
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
