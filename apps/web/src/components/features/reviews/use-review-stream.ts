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

      if (!res.ok) {
        const message = await res.text().catch(() => res.statusText);
        setState((s) => ({ ...s, status: "failed", error: message || "Request failed" }));
        return;
      }

      const { reviewId, status } = await res.json();
      if (!reviewId) {
        setState((s) => ({ ...s, status: "failed", error: "No reviewId returned" }));
        return;
      }

      setState((s) => ({
        ...s,
        reviewId,
        status: status === "completed" ? "completed" : "streaming",
      }));

      // Now stream via SSE
      const eventSource = new EventSource(`/api/reviews/${reviewId}/stream`);

      // Store event source in abort ref to close it on abort
      abortRef.current = {
        abort: () => {
          eventSource.close();
          controller.abort();
        },
      } as unknown as AbortController;

      eventSource.onmessage = (event) => {
        try {
          const chunk = JSON.parse(event.data) as ReviewChunk;
          setState((s) => applyChunk(s, chunk));

          if (chunk.type === "final" || chunk.type === "error") {
            eventSource.close();
            setState((s) =>
              s.status === "streaming"
                ? { ...s, status: chunk.type === "final" ? "completed" : "failed" }
                : s,
            );
          }
        } catch {
          // Ignore invalid chunks
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        setState((s) => ({
          ...s,
          status: s.status === "streaming" ? "failed" : s.status,
          error: "Stream connection lost",
        }));
      };
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
