"use client";

import type { ReviewChunk } from "@acr/agent";
import { Activity, ChevronDown } from "lucide-react";
import { useState } from "react";

import { ActivityTimeline } from "@/components/features/reviews/activity-timeline";
import { reconstructState } from "@/lib/review-stream-state";
import { cn } from "@/lib/utils";

/**
 * Replays a persisted review run from its `agent_events` stream. Folds the
 * chunks through the same reducer the live UI uses, then surfaces the run's
 * tool activity and the agent's streamed reasoning — the "how it got there"
 * that the final output alone doesn't show.
 */
export function ReplayTimeline({ events }: { events: ReviewChunk[] }) {
  const [showReasoning, setShowReasoning] = useState(false);

  if (events.length === 0) return null;

  const state = reconstructState(events);
  const toolCalls = state.toolEvents.filter((e) => e.kind === "call").length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Agent activity
        </h2>
        <span className="text-muted-foreground text-xs">
          {state.ticker.length} step{state.ticker.length === 1 ? "" : "s"} · {toolCalls} tool call
          {toolCalls === 1 ? "" : "s"}
        </span>
      </div>

      <ActivityTimeline events={state.toolEvents} />

      {state.text.trim().length > 0 ? (
        <div className="rounded-lg border border-border/50 bg-muted/20">
          <button
            type="button"
            onClick={() => setShowReasoning((v) => !v)}
            className="flex w-full items-center justify-between p-3 text-left font-medium text-muted-foreground text-sm transition-colors hover:text-foreground"
          >
            <span className="flex items-center gap-2">
              <Activity className="size-3.5" />
              Agent reasoning
            </span>
            <ChevronDown
              className={cn(
                "size-4 transition-transform duration-200",
                showReasoning && "rotate-180",
              )}
            />
          </button>
          {showReasoning ? (
            <div className="border-border/30 border-t px-3 pt-2 pb-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-muted-foreground text-xs leading-relaxed">
                {state.text}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
