"use client";

import { ChevronDown, Wrench } from "lucide-react";
import { useState } from "react";

import type { ToolEvent } from "@/components/features/reviews/use-review-stream";
import { cn } from "@/lib/utils";

function truncate(val: unknown, max = 120): string {
  const s = typeof val === "string" ? val : JSON.stringify(val);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function ActivityTimeline({ events }: { events: ToolEvent[] }) {
  const [open, setOpen] = useState(false);

  if (events.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="flex items-center gap-2">
          <Wrench className="size-3.5" />
          Tool Activity ({events.length})
        </span>
        <ChevronDown
          className={cn("size-4 transition-transform duration-200", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="border-t border-border/30 px-3 pb-3">
          <ul className="flex flex-col gap-1.5 pt-2">
            {events.map((ev, i) => (
              <li key={`${i}-${ev.name}`} className="flex items-start gap-2 font-mono text-xs">
                <span
                  className={cn(
                    "mt-0.5 inline-block size-1.5 shrink-0 rounded-full",
                    ev.kind === "call" ? "bg-blue-400" : "bg-emerald-400",
                  )}
                />
                <span className="text-muted-foreground">
                  <span className="font-semibold text-foreground">{ev.name}</span>
                  {ev.kind === "call" && (
                    <span className="ml-1.5 text-blue-400/80">→ {truncate(ev.input)}</span>
                  )}
                  {ev.kind === "result" && (
                    <span className="ml-1.5 text-emerald-400/80">← {truncate(ev.output)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
