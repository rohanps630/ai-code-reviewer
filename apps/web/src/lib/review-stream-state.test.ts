import type { ReviewChunk } from "@acr/agent";
import { describe, expect, it } from "vitest";

import {
  INITIAL_REVIEW_STREAM_STATE,
  applyChunk,
  reconstructState,
} from "@/lib/review-stream-state";

const final: ReviewChunk = {
  type: "final",
  output: { summary: "ok", findings: [], confidence: "high" },
  usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
};

describe("applyChunk", () => {
  it("appends status messages to the ticker", () => {
    const s = applyChunk(INITIAL_REVIEW_STREAM_STATE, { type: "status", message: "Searching…" });
    expect(s.ticker).toEqual(["Searching…"]);
  });

  it("concatenates text deltas", () => {
    let s = applyChunk(INITIAL_REVIEW_STREAM_STATE, { type: "text", delta: "Hello " });
    s = applyChunk(s, { type: "text", delta: "world" });
    expect(s.text).toBe("Hello world");
  });

  it("records tool calls and results in order", () => {
    let s = applyChunk(INITIAL_REVIEW_STREAM_STATE, {
      type: "tool_call",
      name: "search_code",
      input: { query: "auth" },
    });
    s = applyChunk(s, { type: "tool_result", name: "search_code", output: ["a", "b"] });
    expect(s.toolEvents).toEqual([
      { kind: "call", name: "search_code", input: { query: "auth" } },
      { kind: "result", name: "search_code", output: ["a", "b"] },
    ]);
  });

  it("captures final output, usage, and completed status", () => {
    const s = applyChunk(INITIAL_REVIEW_STREAM_STATE, final);
    expect(s.status).toBe("completed");
    expect(s.final?.summary).toBe("ok");
    expect(s.usage?.costUsd).toBe(0.001);
  });

  it("marks failed on an error chunk", () => {
    const s = applyChunk(INITIAL_REVIEW_STREAM_STATE, { type: "error", message: "boom" });
    expect(s.status).toBe("failed");
    expect(s.error).toBe("boom");
  });
});

describe("reconstructState", () => {
  it("rebuilds the same state from an ordered chunk list (replay parity)", () => {
    const chunks: ReviewChunk[] = [
      { type: "status", message: "Planning…" },
      { type: "tool_call", name: "read_file", input: { path: "a.ts" } },
      { type: "tool_result", name: "read_file", output: "contents" },
      { type: "text", delta: "Looks " },
      { type: "text", delta: "good." },
      final,
    ];

    const replayed = reconstructState(chunks);
    const live = chunks.reduce(applyChunk, INITIAL_REVIEW_STREAM_STATE);

    expect(replayed).toEqual(live);
    expect(replayed.ticker).toEqual(["Planning…"]);
    expect(replayed.text).toBe("Looks good.");
    expect(replayed.toolEvents).toHaveLength(2);
    expect(replayed.status).toBe("completed");
  });

  it("returns the initial state for an empty stream", () => {
    expect(reconstructState([])).toEqual(INITIAL_REVIEW_STREAM_STATE);
  });
});
