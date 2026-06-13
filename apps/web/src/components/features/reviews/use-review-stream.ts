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

/** Max transient-failure reconnects before the stream is declared failed. */
const MAX_RECONNECTS = 5;
/** Base backoff; grows linearly per attempt (500ms, 1s, 1.5s, …). */
const RECONNECT_BASE_MS = 500;

type TerminalReason = "final" | "error" | "incomplete";

/**
 * Drive a review from submission to completion.
 *
 * Transport: `POST /api/reviews` enqueues the review, then the live run is
 * tailed from `GET /api/reviews/[id]/stream` as NDJSON read through a `fetch`
 * `ReadableStream`. `fetch` (unlike `EventSource`) sends the same-origin auth
 * cookie and lets us own reconnection. Each (re)connection replays the full
 * ordered event history, so we re-fold from a clean state on every attempt and
 * the result converges regardless of how many times we reconnect.
 */
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
          credentials: "same-origin",
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

      const { reviewId } = (await res.json()) as { reviewId?: string; status?: string };
      if (!reviewId) {
        setState((s) => ({ ...s, status: "failed", error: "No reviewId returned" }));
        return;
      }

      setState((s) => ({ ...s, reviewId, status: "streaming" }));

      await streamWithReconnect(reviewId, controller.signal, setState);
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

/**
 * Consume one NDJSON stream connection, folding chunks into a fresh state.
 * Returns why the connection ended so the caller can decide whether to retry.
 */
async function consumeOnce(
  reviewId: string,
  signal: AbortSignal,
  setState: React.Dispatch<React.SetStateAction<ReviewStreamState>>,
): Promise<TerminalReason> {
  const res = await fetch(`/api/reviews/${reviewId}/stream`, {
    credentials: "same-origin",
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Stream responded ${res.status}`);
  }

  // Each connection is a full replay; rebuild from scratch.
  let acc: ReviewStreamState = { ...INITIAL, reviewId, status: "streaming" };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (line: string): TerminalReason | null => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let chunk: ReviewChunk;
    try {
      chunk = JSON.parse(trimmed) as ReviewChunk;
    } catch {
      return null; // ignore a partial/garbage line
    }
    acc = applyChunk(acc, chunk);
    setState(acc);
    if (chunk.type === "final") return "final";
    if (chunk.type === "error") return "error";
    return null;
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const terminal = handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      if (terminal) return terminal;
      nl = buffer.indexOf("\n");
    }
  }
  // Flush any trailing line without a newline terminator.
  const terminal = handleLine(buffer);
  return terminal ?? "incomplete";
}

/** Run `consumeOnce` with bounded, backed-off reconnection on transient drops. */
async function streamWithReconnect(
  reviewId: string,
  signal: AbortSignal,
  setState: React.Dispatch<React.SetStateAction<ReviewStreamState>>,
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RECONNECTS; attempt++) {
    try {
      const reason = await consumeOnce(reviewId, signal, setState);
      if (reason === "final") {
        setState((s) => (s.status === "streaming" ? { ...s, status: "completed" } : s));
        return;
      }
      if (reason === "error") {
        setState((s) => (s.status === "streaming" ? { ...s, status: "failed" } : s));
        return;
      }
      // "incomplete": the connection closed before a terminal chunk — retry.
    } catch (err) {
      if (signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
      // fall through to backoff + retry
    }

    if (attempt < MAX_RECONNECTS) {
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_BASE_MS * (attempt + 1)));
      if (signal.aborted) return;
    }
  }

  setState((s) =>
    s.status === "streaming" ? { ...s, status: "failed", error: "Stream connection lost" } : s,
  );
}
