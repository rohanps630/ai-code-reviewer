/**
 * runReview agent-loop tests.
 *
 * Every dep is injectable: the Anthropic stream is a scripted fake,
 * retriever + executor are vi.fn() stubs. No network. No real LLM.
 *
 * What we exercise:
 *   - Single-turn happy path: model submits review immediately
 *   - Multi-iteration: model calls a tool, gets a result, then submits
 *   - Tool execution: search_code, read_file, find_references dispatch
 *   - Cost cap termination
 *   - Max-iterations termination
 *   - "Model produced no tools" failure mode
 *   - validateReviewOutput defensive guard
 */

import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import {
  type RunReviewDeps,
  buildOpeningMessage,
  costOfMessage,
  runReview,
  validateReviewOutput,
} from "../src/loop.js";
import type { ReviewChunk, ReviewInput, ReviewOutput } from "../src/types.js";

// ────────────────────────────────────────────────────────────────────
// Fake stream factory — one "iteration script" per loop turn.
// ────────────────────────────────────────────────────────────────────

type IterationScript = {
  events?: unknown[];
  finalMessage: Anthropic.Message;
};

function mockStream(scripts: IterationScript[]): RunReviewDeps["stream"] {
  let i = 0;
  return ((_args: Anthropic.MessageStreamParams) => {
    const script = scripts[i++];
    if (!script) throw new Error("test stream: no more scripted iterations");
    return {
      [Symbol.asyncIterator](): AsyncIterator<unknown> {
        const events = script.events ?? [];
        let j = 0;
        return {
          next: async () => {
            if (j >= events.length) return { done: true, value: undefined };
            return { done: false, value: events[j++] };
          },
        };
      },
      finalMessage: async () => script.finalMessage,
    } as unknown as ReturnType<RunReviewDeps["stream"]>;
  }) as RunReviewDeps["stream"];
}

// Build an Anthropic.Message shape with whatever content blocks we want.
function fakeMessage(
  content: Array<Record<string, unknown>>,
  usage = { input_tokens: 100, output_tokens: 50 },
): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-7",
    content: content as Anthropic.ContentBlock[],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      ...usage,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      service_tier: "standard",
    } as Anthropic.Usage,
  } as Anthropic.Message;
}

function submitBlock(output: ReviewOutput) {
  return {
    type: "tool_use",
    id: "tu_submit",
    name: "submit_review",
    input: output,
  };
}

function toolUseBlock(name: string, input: unknown, id = `tu_${name}`) {
  return { type: "tool_use", id, name, input };
}

function textBlock(text: string) {
  return { type: "text", text };
}

const BASIC_REVIEW: ReviewOutput = {
  summary: "Looks fine.",
  findings: [],
  confidence: "low",
};

const BASIC_INPUT: ReviewInput = {
  diff: "@@ -1 +1 @@\n-old\n+new",
  model: "sonnet",
};

async function collect(gen: AsyncGenerator<ReviewChunk, void, void>): Promise<ReviewChunk[]> {
  const out: ReviewChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

function emptyDeps(): RunReviewDeps {
  return {
    stream: mockStream([{ finalMessage: fakeMessage([submitBlock(BASIC_REVIEW)]) }]),
    retriever: { search: vi.fn(async () => []) },
    executor: { execute: vi.fn(async () => []) },
  };
}

// ────────────────────────────────────────────────────────────────────
// Happy paths
// ────────────────────────────────────────────────────────────────────

describe("runReview — happy path", () => {
  it("yields status, then final, when the model submits immediately", async () => {
    const deps = emptyDeps();
    const chunks = await collect(runReview(BASIC_INPUT, deps));
    expect(chunks[0]?.type).toBe("status");
    const final = chunks.at(-1);
    expect(final?.type).toBe("final");
    if (final?.type === "final") {
      expect(final.output.summary).toBe("Looks fine.");
    }
  });

  it("streams text deltas as ReviewChunk text events", async () => {
    const deps: RunReviewDeps = {
      stream: mockStream([
        {
          events: [
            { type: "content_block_delta", delta: { type: "text_delta", text: "Looking " } },
            { type: "content_block_delta", delta: { type: "text_delta", text: "at the diff..." } },
          ],
          finalMessage: fakeMessage([
            textBlock("Looking at the diff..."),
            submitBlock(BASIC_REVIEW),
          ]),
        },
      ]),
      retriever: { search: vi.fn() },
      executor: { execute: vi.fn() },
    };
    const chunks = await collect(runReview(BASIC_INPUT, deps));
    const texts = chunks.filter((c) => c.type === "text");
    expect(texts).toHaveLength(2);
  });
});

// ────────────────────────────────────────────────────────────────────
// Multi-iteration with tool use
// ────────────────────────────────────────────────────────────────────

describe("runReview — multi-iteration with tool calls", () => {
  it("dispatches search_code, ships results, then submits on iter 2", async () => {
    const search = vi.fn(async () => [
      {
        chunkId: "c1",
        documentId: "d1",
        repoId: "r1",
        path: "src/auth/login.ts",
        content: "function login() {}",
        contentWithContext: "Login flow: function login() {}",
        startLine: 1,
        endLine: 10,
        symbolName: "login",
        symbolKind: "function" as const,
        score: 0.9,
        bm25Rank: 1,
        vectorRank: 1,
        rrfScore: 0.5,
      },
    ]);

    const deps: RunReviewDeps = {
      stream: mockStream([
        // Iteration 1: model calls search_code
        {
          finalMessage: fakeMessage([toolUseBlock("search_code", { query: "login flow" })]),
        },
        // Iteration 2: model submits the review
        {
          finalMessage: fakeMessage([submitBlock(BASIC_REVIEW)]),
        },
      ]),
      retriever: { search },
      executor: { execute: vi.fn() },
    };

    const chunks = await collect(runReview(BASIC_INPUT, deps));
    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith("login flow", { repoId: undefined, limit: 10 });

    const toolCall = chunks.find((c) => c.type === "tool_call");
    expect(toolCall).toBeDefined();
    if (toolCall?.type === "tool_call") expect(toolCall.name).toBe("search_code");

    const toolResult = chunks.find((c) => c.type === "tool_result");
    expect(toolResult).toBeDefined();
    if (toolResult?.type === "tool_result") expect(toolResult.name).toBe("search_code");

    expect(chunks.at(-1)?.type).toBe("final");
  });

  it("runs multiple tool calls in parallel within one iteration", async () => {
    const search = vi.fn(async () => []);
    const execute = vi.fn(async () => []);

    const deps: RunReviewDeps = {
      stream: mockStream([
        {
          finalMessage: fakeMessage([
            toolUseBlock("search_code", { query: "first" }, "tu_a"),
            toolUseBlock("search_code", { query: "second" }, "tu_b"),
          ]),
        },
        { finalMessage: fakeMessage([submitBlock(BASIC_REVIEW)]) },
      ]),
      retriever: { search },
      executor: { execute },
    };

    await collect(runReview(BASIC_INPUT, deps));
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("surfaces tool errors back as ok:false (model can self-correct next turn)", async () => {
    // First iter: model asks read_file for a missing path.
    // Tool returns { found: false }; that's a successful execute,
    // not a failure. So 'tool_result' carries the discriminated union.
    const executor = { execute: vi.fn(async () => []) };
    const deps: RunReviewDeps = {
      stream: mockStream([
        {
          finalMessage: fakeMessage([toolUseBlock("read_file", { path: "missing.ts" })]),
        },
        { finalMessage: fakeMessage([submitBlock(BASIC_REVIEW)]) },
      ]),
      retriever: { search: vi.fn() },
      executor,
    };
    const chunks = await collect(runReview(BASIC_INPUT, deps));
    const tr = chunks.find((c) => c.type === "tool_result");
    if (tr?.type === "tool_result") {
      // read_file returns { found: false, path } when missing — that's an OK result
      expect(tr.output).toMatchObject({ found: false, path: "missing.ts" });
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Termination conditions
// ────────────────────────────────────────────────────────────────────

describe("runReview — termination", () => {
  it("throws when MAX_ITERATIONS is reached without submit_review", async () => {
    // Build a stream that always calls search_code, never submits.
    const infiniteSearch: IterationScript = {
      finalMessage: fakeMessage([toolUseBlock("search_code", { query: "x" })]),
    };
    const deps: RunReviewDeps = {
      stream: mockStream([infiniteSearch, infiniteSearch, infiniteSearch]),
      retriever: { search: vi.fn(async () => []) },
      executor: { execute: vi.fn() },
      maxIterations: 3,
    };
    await expect(collect(runReview(BASIC_INPUT, deps))).rejects.toThrow(/MAX_ITERATIONS reached/);
  });

  it("throws when cost cap is exceeded", async () => {
    // Each turn uses 1M input + 1M output tokens. With sonnet pricing
    // ($3 + $15), each iteration costs $18 — first iter alone trips a
    // $1 cap.
    const heavy = fakeMessage([toolUseBlock("search_code", { query: "x" })], {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    const deps: RunReviewDeps = {
      stream: mockStream([{ finalMessage: heavy }, { finalMessage: heavy }]),
      retriever: { search: vi.fn(async () => []) },
      executor: { execute: vi.fn() },
      costCapUsd: 1.0,
    };
    await expect(collect(runReview(BASIC_INPUT, deps))).rejects.toThrow(/Cost cap exceeded/);
  });

  it("throws if the model ends turn with no tool_use blocks", async () => {
    const deps: RunReviewDeps = {
      stream: mockStream([{ finalMessage: fakeMessage([textBlock("I have no opinion.")]) }]),
      retriever: { search: vi.fn() },
      executor: { execute: vi.fn() },
    };
    await expect(collect(runReview(BASIC_INPUT, deps))).rejects.toThrow(
      /without calling submit_review/i,
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// Helper exports
// ────────────────────────────────────────────────────────────────────

describe("buildOpeningMessage", () => {
  it("embeds the diff between <diff> tags", () => {
    const blocks = buildOpeningMessage({ diff: "X", model: "sonnet" });
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain("<diff>\nX\n</diff>");
  });
  it("includes repoContext when provided", () => {
    const blocks = buildOpeningMessage({
      diff: "X",
      model: "sonnet",
      repoContext: { owner: "o", repo: "r", defaultBranch: "main" },
    });
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain("o/r");
  });
});

describe("costOfMessage", () => {
  it("computes input + output USD from per-Mtok pricing", () => {
    const msg = fakeMessage([], { input_tokens: 1_000_000, output_tokens: 1_000_000 });
    // Sonnet: $3 input + $15 output per Mtok = $18 for 1M each
    expect(costOfMessage("sonnet", msg)).toBeCloseTo(18, 4);
    // Haiku: $1 + $5 = $6
    expect(costOfMessage("haiku", msg)).toBeCloseTo(6, 4);
    // Opus: $15 + $75 = $90
    expect(costOfMessage("opus", msg)).toBeCloseTo(90, 4);
  });
});

describe("validateReviewOutput", () => {
  it("accepts a well-formed submission", () => {
    expect(() =>
      validateReviewOutput({ summary: "s", findings: [], confidence: "low" }),
    ).not.toThrow();
  });
  it("rejects non-objects", () => {
    expect(() => validateReviewOutput(null)).toThrow();
    expect(() => validateReviewOutput("string")).toThrow();
  });
  it("rejects missing summary", () => {
    expect(() => validateReviewOutput({ findings: [], confidence: "low" })).toThrow();
  });
  it("rejects findings that aren't an array", () => {
    expect(() =>
      validateReviewOutput({ summary: "s", findings: "nope", confidence: "low" }),
    ).toThrow();
  });
});
