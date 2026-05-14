"use client";

import type { ReviewChunk, ReviewOutput } from "@acr/agent";
import { useCallback, useState } from "react";

export type ReviewStreamState = {
  status: "idle" | "streaming" | "completed" | "failed";
  text: string;
  ticker: string[];
  final: ReviewOutput | null;
  reviewId: string | null;
  error: string | null;
};

const INITIAL: ReviewStreamState = {
  status: "idle",
  text: "",
  ticker: [],
  final: null,
  reviewId: null,
  error: null,
};

export function useReviewStream() {
  const [state, setState] = useState<ReviewStreamState>(INITIAL);

  const run = useCallback(async (input: { diff: string; model: "haiku" | "sonnet" | "opus" }) => {
    setState({ ...INITIAL, status: "streaming" });

    let res: Response;
    try {
      res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "failed",
        error: err instanceof Error ? err.message : "Request failed",
      }));
      return;
    }

    const reviewId = res.headers.get("X-Review-Id");
    if (reviewId) setState((s) => ({ ...s, reviewId }));

    if (!res.ok || !res.body) {
      const message = await res.text().catch(() => res.statusText);
      setState((s) => ({ ...s, status: "failed", error: message || "Request failed" }));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length === 0) continue;
        let chunk: ReviewChunk;
        try {
          chunk = JSON.parse(line) as ReviewChunk;
        } catch {
          continue;
        }
        setState((s) => applyChunk(s, chunk));
      }
    }
    setState((s) => (s.status === "streaming" ? { ...s, status: "completed" } : s));
  }, []);

  const reset = useCallback(() => setState(INITIAL), []);

  return { ...state, run, reset };
}

function applyChunk(state: ReviewStreamState, chunk: ReviewChunk): ReviewStreamState {
  switch (chunk.type) {
    case "status":
      return { ...state, ticker: [...state.ticker, chunk.message] };
    case "text":
      return { ...state, text: state.text + chunk.delta };
    case "final":
      return { ...state, final: chunk.output, status: "completed" };
    default:
      return state;
  }
}
