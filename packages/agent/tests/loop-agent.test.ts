/**
 * runReview agent-loop tests.
 *
 * Every dep is injectable: the model provider is a scripted fake,
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

import { describe, expect, it, vi } from "vitest";

import {
  type RunReviewDeps,
  buildOpeningMessage,
  runReview,
  validateReviewOutput,
} from "../src/loop.js";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  StopReason,
} from "../src/providers/index.js";
import type { ReviewChunk, ReviewInput, ReviewOutput } from "../src/types.js";

// ────────────────────────────────────────────────────────────────────
// Scripted Response type & provider builder
// ────────────────────────────────────────────────────────────────────

type ScriptedResponse = {
  text: string;
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  stopReason?: StopReason;
};

function mockProvider(responses: ScriptedResponse[]): ModelProvider {
  let callCount = 0;
  return {
    provider: "anthropic",
    modelId: "claude-sonnet-4-7",
    generate: async (_request: ModelRequest): Promise<ModelResponse> => {
      const resp = responses[callCount++];
      if (!resp)
        throw new Error(`Mock provider: no more responses configured (callCount: ${callCount})`);
      return {
        text: resp.text,
        toolCalls: resp.toolCalls ?? [],
        usage: {
          inputTokens: resp.usage?.inputTokens ?? 100,
          outputTokens: resp.usage?.outputTokens ?? 50,
          cacheReadTokens: resp.usage?.cacheReadTokens,
          cacheCreationTokens: resp.usage?.cacheCreationTokens,
        },
        stopReason:
          resp.stopReason ?? (resp.toolCalls && resp.toolCalls.length > 0 ? "tool_calls" : "stop"),
      };
    },
  };
}

function submitBlock(output: ReviewOutput) {
  return {
    type: "tool_use" as const,
    id: "tu_submit",
    name: "submit_review",
    input: output,
  };
}

function toolUseBlock(name: string, input: unknown, id = `tu_${name}`) {
  return { type: "tool_use" as const, id, name, input };
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

function emptyDeps(provider: ModelProvider): RunReviewDeps {
  return {
    provider,
    retriever: { search: vi.fn(async () => []) },
    codeSource: {
      readFile: vi.fn(async () => ({ found: false })),
      findReferences: vi.fn(async () => []),
    } as unknown as CodeSource,
  };
}

// ────────────────────────────────────────────────────────────────────
// Happy paths
// ────────────────────────────────────────────────────────────────────

describe("runReview — happy path", () => {
  it("yields status, then final, when the model submits immediately", async () => {
    const provider = mockProvider([
      {
        text: "",
        toolCalls: [submitBlock(BASIC_REVIEW)],
      },
    ]);
    const deps = emptyDeps(provider);
    const chunks = await collect(runReview(BASIC_INPUT, deps));
    expect(chunks[0]?.type).toBe("status");
    const final = chunks.at(-1);
    expect(final?.type).toBe("final");
    if (final?.type === "final") {
      expect(final.output.summary).toBe("Looks fine.");
      expect(final.usage).toBeDefined();
    }
  });

  it("streams text deltas as ReviewChunk text events", async () => {
    const provider = mockProvider([
      {
        text: "Looking at the diff...",
        toolCalls: [submitBlock(BASIC_REVIEW)],
      },
    ]);
    const deps = emptyDeps(provider);
    const chunks = await collect(runReview(BASIC_INPUT, deps));
    const texts = chunks.filter((c) => c.type === "text");
    expect(texts).toHaveLength(1);
    if (texts[0]?.type === "text") {
      expect(texts[0].delta).toBe("Looking at the diff...");
    }
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

    const provider = mockProvider([
      { text: "", toolCalls: [toolUseBlock("search_code", { query: "login flow" })] },
      { text: "", toolCalls: [submitBlock(BASIC_REVIEW)] },
    ]);

    const deps: RunReviewDeps = {
      provider,
      retriever: { search },
      codeSource: { readFile: vi.fn(), findReferences: vi.fn() } as unknown as CodeSource,
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

    const provider = mockProvider([
      {
        text: "",
        toolCalls: [
          toolUseBlock("search_code", { query: "first" }, "tu_a"),
          toolUseBlock("search_code", { query: "second" }, "tu_b"),
        ],
      },
      { text: "", toolCalls: [submitBlock(BASIC_REVIEW)] },
    ]);

    const deps: RunReviewDeps = {
      provider,
      retriever: { search },
      codeSource: { readFile: vi.fn(), findReferences: vi.fn() } as unknown as CodeSource,
    };

    await collect(runReview(BASIC_INPUT, deps));
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("surfaces tool errors back as ok:false (model can self-correct next turn)", async () => {
    const executor = {
      readFile: vi.fn(async () => ({ found: false })),
      findReferences: vi.fn(async () => []),
    } as unknown as CodeSource;
    const provider = mockProvider([
      { text: "", toolCalls: [toolUseBlock("read_file", { path: "missing.ts" })] },
      { text: "", toolCalls: [submitBlock(BASIC_REVIEW)] },
    ]);
    const deps: RunReviewDeps = {
      provider,
      retriever: { search: vi.fn() },
      codeSource: executor,
    };
    const chunks = await collect(runReview(BASIC_INPUT, deps));
    const tr = chunks.find((c) => c.type === "tool_result");
    if (tr?.type === "tool_result") {
      expect(tr.output).toMatchObject({ found: false, path: "missing.ts" });
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Termination conditions
// ────────────────────────────────────────────────────────────────────

describe("runReview — termination", () => {
  it("throws when MAX_ITERATIONS is reached without submit_review", async () => {
    const provider = mockProvider([
      { text: "", toolCalls: [toolUseBlock("search_code", { query: "x" })] },
      { text: "", toolCalls: [toolUseBlock("search_code", { query: "x" })] },
      { text: "", toolCalls: [toolUseBlock("search_code", { query: "x" })] },
    ]);
    const deps: RunReviewDeps = {
      provider,
      retriever: { search: vi.fn(async () => []) },
      codeSource: { readFile: vi.fn(), findReferences: vi.fn() } as unknown as CodeSource,
      maxIterations: 3,
    };
    await expect(collect(runReview(BASIC_INPUT, deps))).rejects.toThrow(/MAX_ITERATIONS reached/);
  });

  it("throws when cost cap is exceeded", async () => {
    const provider = mockProvider([
      {
        text: "",
        toolCalls: [toolUseBlock("search_code", { query: "x" })],
        usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      },
    ]);
    const deps: RunReviewDeps = {
      provider,
      retriever: { search: vi.fn(async () => []) },
      codeSource: { readFile: vi.fn(), findReferences: vi.fn() } as unknown as CodeSource,
      costCapUsd: 1.0,
    };
    await expect(collect(runReview(BASIC_INPUT, deps))).rejects.toThrow(/Cost cap exceeded/);
  });

  it("throws if the model ends turn with no tool_use blocks", async () => {
    const provider = mockProvider([{ text: "I have no opinion." }]);
    const deps: RunReviewDeps = {
      provider,
      retriever: { search: vi.fn() },
      codeSource: { readFile: vi.fn(), findReferences: vi.fn() } as unknown as CodeSource,
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
    const text = buildOpeningMessage({ diff: "X", model: "sonnet" });
    expect(text).toContain("<diff>\nX\n</diff>");
  });
  it("includes repoContext when provided", () => {
    const text = buildOpeningMessage({
      diff: "X",
      model: "sonnet",
      repoContext: { owner: "o", repo: "r", defaultBranch: "main" },
    });
    expect(text).toContain("o/r");
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
