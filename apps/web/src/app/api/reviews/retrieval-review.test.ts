/**
 * retrieval-review orchestrator tests.
 *
 * The orchestrator wraps two side effects — `searchCode` and the
 * Anthropic stream — so both go through injectable deps. Tests
 * construct plain objects that satisfy the dep contract; no network
 * touches.
 */

import type { ReviewChunk, ReviewOutput, SearchResult } from "@acr/agent";
import { describe, expect, it, vi } from "vitest";

import {
  type RetrievalReviewDeps,
  buildUserPrompt,
  dedupeByChunkId,
  retrievalAugmentedReview,
} from "./retrieval-review";

// ────────────────────────────────────────────────────────────────────
// Fixture helpers
// ────────────────────────────────────────────────────────────────────

function hit(id: string, path = `src/${id}.ts`): SearchResult {
  return {
    chunkId: id,
    documentId: `doc-${id}`,
    repoId: "repo-1",
    path,
    content: `// chunk ${id}\nfunction ${id}() {}`,
    contentWithContext: `Context: function ${id} in ${path}.\nfunction ${id}() {}`,
    startLine: 1,
    endLine: 5,
    symbolName: id,
    symbolKind: "function",
    score: 0.8,
    bm25Rank: 1,
    vectorRank: 1,
    rrfScore: 0.5,
  };
}

/** Build a minimal async-iterable + `finalMessage()` stand-in for
 *  what `anthropic.messages.stream(...)` returns. We only need the
 *  iteration protocol + finalMessage(); nothing else. */
function fakeStream(
  events: unknown[],
  final: { content: Array<Record<string, unknown>> },
): unknown {
  return {
    [Symbol.asyncIterator](): AsyncIterator<unknown> {
      let i = 0;
      return {
        next: async () => {
          if (i >= events.length) return { done: true, value: undefined };
          return { done: false, value: events[i++] };
        },
      };
    },
    finalMessage: async () => final,
  };
}

function toolUseFinal(output: ReviewOutput) {
  return {
    content: [{ type: "tool_use", name: "submit_review", input: output }],
  };
}

function makeDeps(opts: {
  searchResults?: Record<string, SearchResult[]>;
  events?: unknown[];
  final?: { content: Array<Record<string, unknown>> };
}): RetrievalReviewDeps & {
  searchCalls: Array<{ query: string; options?: unknown }>;
  streamCalls: unknown[];
} {
  const searchCalls: Array<{ query: string; options?: unknown }> = [];
  const search = vi.fn(async (query: string, options?: unknown) => {
    searchCalls.push({ query, options });
    return opts.searchResults?.[query] ?? [];
  });

  const streamCalls: unknown[] = [];
  const stream = vi.fn((args: unknown) => {
    streamCalls.push(args);
    return fakeStream(opts.events ?? [], opts.final ?? toolUseFinal(BASIC_OUTPUT));
  });

  return {
    search: search as unknown as RetrievalReviewDeps["search"],
    stream: stream as unknown as RetrievalReviewDeps["stream"],
    searchCalls,
    streamCalls,
  };
}

const BASIC_OUTPUT: ReviewOutput = {
  summary: "LGTM.",
  findings: [],
  confidence: "low",
};

const SAMPLE_DIFF = `diff --git a/src/auth/login.ts b/src/auth/login.ts
@@ -10,5 +10,8 @@ export function login(req: Request) {
-  const session = createSession(userId);
+  const session = createSession(userId, { issuedAt: Date.now() });
+  return audit(session);
 }
`;

async function collect(gen: AsyncGenerator<ReviewChunk, void, void>): Promise<ReviewChunk[]> {
  const out: ReviewChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Helpers (unit)
// ────────────────────────────────────────────────────────────────────

describe("dedupeByChunkId", () => {
  it("keeps first occurrence and drops repeats", () => {
    const out = dedupeByChunkId([hit("a"), hit("b"), hit("a")]);
    expect(out.map((h) => h.chunkId)).toEqual(["a", "b"]);
  });
});

describe("buildUserPrompt", () => {
  it("embeds the diff between <diff> tags", () => {
    const prompt = buildUserPrompt("DIFF_BODY", []);
    expect(prompt).toContain("<diff>\nDIFF_BODY\n</diff>");
  });

  it("includes the path:line range and symbol for each context hit", () => {
    const prompt = buildUserPrompt("DIFF", [hit("login", "src/auth/login.ts")]);
    expect(prompt).toContain("src/auth/login.ts:1-5");
    expect(prompt).toContain("function login");
  });

  it("notes 'No retrieved context available' when context is empty", () => {
    const prompt = buildUserPrompt("DIFF", []);
    expect(prompt).toContain("No retrieved context available");
  });
});

// ────────────────────────────────────────────────────────────────────
// retrievalAugmentedReview — integration
// ────────────────────────────────────────────────────────────────────

describe("retrievalAugmentedReview", () => {
  it("yields status, text, then a final ReviewChunk", async () => {
    const deps = makeDeps({
      events: [
        { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "world." } },
      ],
      final: toolUseFinal({
        summary: "Adds audit logging to login flow.",
        findings: [],
        confidence: "medium",
      }),
    });

    const chunks = await collect(
      retrievalAugmentedReview({ diff: SAMPLE_DIFF, model: "sonnet" }, deps),
    );

    const kinds = chunks.map((c) => c.type);
    expect(kinds[0]).toBe("status");
    expect(kinds.filter((k) => k === "text")).toHaveLength(2);
    expect(kinds.at(-1)).toBe("final");

    const final = chunks.find((c) => c.type === "final");
    if (final?.type === "final") {
      expect(final.output.summary).toContain("audit");
      expect(final.output.confidence).toBe("medium");
    } else {
      expect.fail("expected a final chunk");
    }
  });

  it("calls search once per extracted query", async () => {
    const deps = makeDeps({});
    await collect(retrievalAugmentedReview({ diff: SAMPLE_DIFF, model: "haiku" }, deps));
    // SAMPLE_DIFF produces several queries; the cap is 5.
    expect(deps.searchCalls.length).toBeGreaterThan(0);
    expect(deps.searchCalls.length).toBeLessThanOrEqual(5);
  });

  it("dedupes context across queries before sending to Claude", async () => {
    const sharedHit = hit("shared", "src/shared.ts");
    const deps = makeDeps({
      searchResults: {
        // Same chunkId returned by two different queries
        "src/shared.ts": [sharedHit],
        createSession: [sharedHit],
      },
    });

    await collect(retrievalAugmentedReview({ diff: SAMPLE_DIFF, model: "sonnet" }, deps));

    const firstStreamCall = deps.streamCalls[0] as {
      messages: Array<{ content: Array<{ text: string }> }>;
    };
    const userText = firstStreamCall.messages[0]?.content[0]?.text ?? "";
    // The shared chunk appears once in the prompt, not twice.
    const occurrences = userText.split("src/shared.ts:1-5").length - 1;
    expect(occurrences).toBe(1);
  });

  it("forwards the repoId filter to every search call", async () => {
    const deps = makeDeps({});
    await collect(
      retrievalAugmentedReview(
        { diff: SAMPLE_DIFF, model: "sonnet", repoId: "00000000-0000-0000-0000-000000000001" },
        deps,
      ),
    );
    for (const call of deps.searchCalls) {
      expect((call.options as { repoId?: string })?.repoId).toBe(
        "00000000-0000-0000-0000-000000000001",
      );
    }
  });

  it("survives a failing search lane (returns [] for that query)", async () => {
    const failingSearch = vi.fn(async () => {
      throw new Error("voyage exploded");
    });
    const deps: RetrievalReviewDeps = {
      search: failingSearch as unknown as RetrievalReviewDeps["search"],
      stream: ((_args: unknown) =>
        fakeStream([], toolUseFinal(BASIC_OUTPUT))) as unknown as RetrievalReviewDeps["stream"],
    };
    const chunks = await collect(
      retrievalAugmentedReview({ diff: SAMPLE_DIFF, model: "sonnet" }, deps),
    );
    // Still produced a final review even though every query threw.
    expect(chunks.at(-1)?.type).toBe("final");
  });

  it("throws if Claude does not call submit_review", async () => {
    const deps = makeDeps({
      final: { content: [{ type: "text", text: "I refuse to use the tool" }] },
    });
    await expect(
      collect(retrievalAugmentedReview({ diff: SAMPLE_DIFF, model: "sonnet" }, deps)),
    ).rejects.toThrow(/submit_review/);
  });

  it("maps model labels to Anthropic IDs", async () => {
    for (const label of ["haiku", "sonnet", "opus"] as const) {
      const deps = makeDeps({});
      await collect(retrievalAugmentedReview({ diff: SAMPLE_DIFF, model: label }, deps));
      const args = deps.streamCalls[0] as { model: string };
      expect(args.model).toMatch(/^claude-(haiku|sonnet|opus)-4-[57]$/);
    }
  });

  it("sends the submit_review tool with tool_choice forced to it", async () => {
    const deps = makeDeps({});
    await collect(retrievalAugmentedReview({ diff: SAMPLE_DIFF, model: "sonnet" }, deps));
    const args = deps.streamCalls[0] as {
      tools: Array<{ name: string }>;
      tool_choice?: { type: string; name?: string };
    };
    expect(args.tools[0]?.name).toBe("submit_review");
    expect(args.tool_choice).toEqual({ type: "tool", name: "submit_review" });
  });
});
