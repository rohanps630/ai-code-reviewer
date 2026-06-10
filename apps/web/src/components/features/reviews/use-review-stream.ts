"use client";

import type { ReviewChunk } from "@acr/agent";
import { useCallback, useRef, useState } from "react";

import {
  INITIAL_REVIEW_STREAM_STATE as INITIAL,
  type ReviewStreamState,
  applyChunk,
} from "@/lib/review-stream-state";

// Re-exported so existing importers (ActivityTimeline, etc.) keep working.
export type { ReviewStreamState, ReviewUsage, ToolEvent } from "@/lib/review-stream-state";

export function useReviewStream() {
  const [state, setState] = useState<ReviewStreamState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) =>
      s.status === "streaming" ? { ...s, status: "failed", error: "Cancelled" } : s,
    );
  }, []);

  const run = useCallback(
    async (input: { diff: string; model: "haiku" | "sonnet" | "opus" | "auto" }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ ...INITIAL, status: "streaming" });

      let res: Response;
      try {
        res = await fetch("/api/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
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
      try {
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
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState((s) => ({
          ...s,
          status: "failed",
          error: err instanceof Error ? err.message : "Stream read failed",
        }));
        return;
      }
      // Only flip to "completed" if an error chunk hasn't already set "failed"
      setState((s) => (s.status === "streaming" ? { ...s, status: "completed" } : s));
    },
    [],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL);
  }, []);

  return { ...state, run, reset, abort };
}
