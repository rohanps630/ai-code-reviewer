/**
 * Static retrieval-augmented review (Phase 2.7).
 *
 * One-shot Claude call wrapped in our hybrid retrieval pipeline. The
 * agent loop with tool use lands in Phase 3 — this module is what
 * runs in the meantime once retrieval is wired in.
 *
 *   diff ─▶ extractQueries() ─┐
 *                              ▼
 *                       searchCode() × N queries (parallel)
 *                              │
 *                              ▼
 *                       dedupe + truncate to N chunks
 *                              │
 *                              ▼
 *                Claude messages.stream({ tools: [submit_review] })
 *                              │
 *                              ▼
 *                      ReviewChunk stream
 *                       (status + text + final)
 *
 * The function is exported but **deliberately not imported by the
 * route yet** (Phase 2.7 ships the path; flipping the switch comes
 * later). Every dep is injectable so tests don't burn API tokens.
 */

import type { Finding, ReviewChunk, ReviewOutput, SearchResult } from "@acr/agent";
import Anthropic from "@anthropic-ai/sdk";

import { extractQueries } from "./diff-queries";

// ────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_QUERIES = 5;
const DEFAULT_CHUNKS_PER_QUERY = 5;
const DEFAULT_MAX_CONTEXT_CHUNKS = 12;
const DEFAULT_MAX_TOKENS = 4096;

/** ReviewInput-aligned model labels → Anthropic model IDs.
 *  Stack pinned in ADR-001; bump these alongside an ADR if Anthropic
 *  releases a newer generation. */
const MODEL_IDS = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-7",
  opus: "claude-opus-4-7",
} as const;

type ModelLabel = keyof typeof MODEL_IDS;

// ────────────────────────────────────────────────────────────────────
// Dep contracts — small enough that tests inject plain objects
// ────────────────────────────────────────────────────────────────────

/** What we need from the retrieval module. Matches `searchCode`'s
 *  signature exactly, kept narrow so a test stub is two lines. */
export type SearchFn = (
  query: string,
  options?: { repoId?: string; limit?: number; candidatesPerLane?: number },
) => Promise<SearchResult[]>;

/** What we need from the Anthropic SDK. Matches the shape of
 *  `client.messages.stream(...)` exactly — including the iterable
 *  result with a `finalMessage()` method we await at the end. */
export type AnthropicStreamFn = Anthropic["messages"]["stream"];

export type RetrievalReviewDeps = {
  search: SearchFn;
  stream: AnthropicStreamFn;
};

export type RetrievalReviewInput = {
  diff: string;
  model: ModelLabel;
  /** Optional repo filter — only chunks from this repo participate. */
  repoId?: string;
  /** Knobs (mostly for evals). All optional with sane defaults. */
  maxQueries?: number;
  chunksPerQuery?: number;
  maxContextChunks?: number;
};

// ────────────────────────────────────────────────────────────────────
// The orchestrator — async generator, same shape as placeholderReview
// ────────────────────────────────────────────────────────────────────

export async function* retrievalAugmentedReview(
  input: RetrievalReviewInput,
  deps: RetrievalReviewDeps,
): AsyncGenerator<ReviewChunk, void, void> {
  const maxQueries = input.maxQueries ?? DEFAULT_MAX_QUERIES;
  const chunksPerQuery = input.chunksPerQuery ?? DEFAULT_CHUNKS_PER_QUERY;
  const maxContextChunks = input.maxContextChunks ?? DEFAULT_MAX_CONTEXT_CHUNKS;

  yield { type: "status", message: "Extracting queries from diff..." };
  const queries = extractQueries(input.diff, { maxQueries });

  yield {
    type: "status",
    message:
      queries.length > 0
        ? `Retrieving context for ${queries.length} ${queries.length === 1 ? "query" : "queries"}...`
        : "No queries extracted; reviewing diff in isolation.",
  };

  // Fan out the search lane; each query gets up to `chunksPerQuery`
  // candidates. Failures in one query shouldn't sink the whole review.
  const perQueryResults = await Promise.all(
    queries.map(async (q) => {
      try {
        return await deps.search(q, { repoId: input.repoId, limit: chunksPerQuery });
      } catch {
        return [];
      }
    }),
  );

  const context = dedupeByChunkId(perQueryResults.flat()).slice(0, maxContextChunks);

  yield {
    type: "status",
    message: `Reviewing with ${context.length} context ${context.length === 1 ? "chunk" : "chunks"}...`,
  };

  const stream = deps.stream({
    model: MODEL_IDS[input.model],
    max_tokens: DEFAULT_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [SUBMIT_REVIEW_TOOL],
    tool_choice: { type: "tool", name: "submit_review" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildUserPrompt(input.diff, context),
          },
        ],
      },
    ],
  });

  // While streaming, surface text-delta chunks so the UI can render
  // progress. The `submit_review` tool's JSON arguments stream as
  // input_json_delta events; we don't expose those to the UI — they're
  // structured output, not prose for the user.
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta" &&
      event.delta.text
    ) {
      yield { type: "text", delta: event.delta.text };
    }
  }

  const final = await stream.finalMessage();
  const output = extractReviewOutput(final);
  yield { type: "final", output };
}

// ────────────────────────────────────────────────────────────────────
// Helpers (exported where useful for tests)
// ────────────────────────────────────────────────────────────────────

/** Build a fresh Anthropic-backed deps bag from env. Server-only. */
export async function defaultRetrievalReviewDeps(): Promise<RetrievalReviewDeps> {
  const [{ serverEnv }, { searchCode }] = await Promise.all([
    import("@acr/shared/env"),
    import("@acr/agent"),
  ]);
  if (!serverEnv.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  const client = new Anthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY });
  return {
    search: searchCode,
    stream: (args) => client.messages.stream(args),
  };
}

export function dedupeByChunkId(hits: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const h of hits) {
    if (seen.has(h.chunkId)) continue;
    seen.add(h.chunkId);
    out.push(h);
  }
  return out;
}

export function buildUserPrompt(diff: string, context: SearchResult[]): string {
  const contextBlock =
    context.length === 0
      ? "No retrieved context available."
      : context
          .map(
            (c, i) =>
              `[${i + 1}] ${c.path}:${c.startLine}-${c.endLine}${c.symbolName ? ` (${c.symbolKind ?? "symbol"} ${c.symbolName})` : ""}\n\`\`\`\n${c.content}\n\`\`\``,
          )
          .join("\n\n");

  return [
    "Review the following diff. Use the retrieved context only if it actually",
    "helps explain or evaluate the change. Cite paths + line ranges in",
    "`locationHint` (e.g. `src/auth/login.ts:42-58`).",
    "",
    "<retrieved-context>",
    contextBlock,
    "</retrieved-context>",
    "",
    "<diff>",
    diff,
    "</diff>",
    "",
    "Call the `submit_review` tool exactly once with your structured findings.",
  ].join("\n");
}

function extractReviewOutput(message: Anthropic.Message): ReviewOutput {
  for (const block of message.content) {
    if (block.type === "tool_use" && block.name === "submit_review") {
      return validateReviewOutput(block.input);
    }
  }
  throw new Error("Claude did not call submit_review");
}

/** Light runtime guard. The tool's input_schema enforces shape at the
 *  Anthropic side; this is a belt to that suspenders. Throws on the
 *  structural surprises (missing fields, wrong types) we'd rather
 *  surface here than ten frames deeper in the UI. */
function validateReviewOutput(raw: unknown): ReviewOutput {
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
// Prompt + tool schema
// ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "You are a senior software engineer reviewing a code change.",
  "Be concise, specific, and avoid restating what the diff already shows.",
  "Prefer findings that point at concrete risks (bugs, regressions, security",
  "issues, performance cliffs) over style nits.",
  "When `locationHint` is given, format it as `path:start-end` so the UI can",
  "jump to it. Confidence reflects how sure you are in the findings overall,",
  "not how confident the code is.",
].join(" ");

const SUBMIT_REVIEW_TOOL: Anthropic.Tool = {
  name: "submit_review",
  description: "Submit a structured code review. Call exactly once at the end of your reasoning.",
  input_schema: {
    type: "object",
    required: ["summary", "findings", "confidence"],
    properties: {
      summary: { type: "string", description: "One-paragraph summary of the change and review." },
      findings: {
        type: "array",
        items: {
          type: "object",
          required: ["category", "severity", "summary"],
          properties: {
            category: {
              type: "string",
              enum: ["bug", "perf", "security", "style", "logic"],
            },
            severity: {
              type: "string",
              enum: ["critical", "major", "minor"],
            },
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
  },
};
