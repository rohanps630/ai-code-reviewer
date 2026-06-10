"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";

import { ActivityTimeline } from "@/components/features/reviews/activity-timeline";
import { FindingItem } from "@/components/features/reviews/finding-item";
import { useReviewStream } from "@/components/features/reviews/use-review-stream";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { Finding } from "@acr/agent";
import { Brain, CirclePlay, Coins, Cpu, PlayCircle, Timer, X, Zap } from "lucide-react";

type Model = "haiku" | "sonnet" | "opus" | "auto";

const MAX_DIFF_BYTES = 500_000;

function isModel(v: string | null | undefined): v is Model {
  return v === "haiku" || v === "sonnet" || v === "opus" || v === "auto";
}

const MODEL_OPTIONS: {
  value: Model;
  label: string;
  description: string;
  tag: string;
  tagVariant: "success" | "default" | "warning" | "secondary";
  icon: React.ElementType;
}[] = [
  {
    value: "haiku",
    label: "Haiku",
    description: "Fastest — great for style & typo checks",
    tag: "Fast",
    tagVariant: "success",
    icon: Zap,
  },
  {
    value: "sonnet",
    label: "Sonnet",
    description: "Balanced speed and depth for most reviews",
    tag: "Balanced",
    tagVariant: "default",
    icon: CirclePlay,
  },
  {
    value: "opus",
    label: "Opus",
    description: "Deepest reasoning for complex diffs",
    tag: "Complex",
    tagVariant: "warning",
    icon: Brain,
  },
  {
    value: "auto",
    label: "Auto-route",
    description: "Picks the best model based on diff size",
    tag: "Smart",
    tagVariant: "secondary",
    icon: Cpu,
  },
];

function ModelSelector({
  value,
  onChange,
  disabled,
}: {
  value: Model;
  onChange: (v: Model) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {MODEL_OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <label
            key={opt.value}
            className={cn(
              "relative flex cursor-pointer flex-col gap-1.5 rounded-xl border p-3 transition-all duration-150",
              selected
                ? "border-primary/40 bg-primary/8 shadow-sm ring-1 ring-primary/25"
                : "border-border bg-card/40 hover:border-border/80 hover:bg-muted/30",
              disabled && "pointer-events-none opacity-50",
            )}
          >
            <input
              type="radio"
              name="model"
              value={opt.value}
              checked={selected}
              onChange={() => onChange(opt.value)}
              className="sr-only"
              disabled={disabled}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <opt.icon
                  className={cn("size-3.5", selected ? "text-primary" : "text-muted-foreground")}
                />
                <span
                  className={cn(
                    "font-medium text-sm",
                    selected ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {opt.label}
                </span>
              </div>
              <Badge variant={opt.tagVariant} className="px-1 py-0 text-[10px]">
                {opt.tag}
              </Badge>
            </div>
            <p className="text-muted-foreground text-xs leading-snug">{opt.description}</p>
          </label>
        );
      })}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  if (status === "streaming")
    return <span className="inline-block size-2 animate-pulse rounded-full bg-emerald-400" />;
  if (status === "completed")
    return <span className="inline-block size-2 rounded-full bg-primary" />;
  if (status === "failed") return <span className="inline-block size-2 rounded-full bg-red-400" />;
  return <span className="inline-block size-2 rounded-full bg-muted-foreground/30" />;
}

function groupFindings(findings: Finding[]) {
  return {
    critical: findings.filter((f) => f.severity === "critical"),
    major: findings.filter((f) => f.severity === "major"),
    minor: findings.filter((f) => f.severity === "minor"),
  };
}

export function NewReviewForm({
  initialDiff,
  initialModel,
}: {
  initialDiff?: string;
  initialModel?: string;
}) {
  const [diff, setDiff] = useState(initialDiff ?? "");
  const [model, setModel] = useState<Model>(isModel(initialModel) ? initialModel : "auto");
  const stream = useReviewStream();

  const diffSizeBytes = new Blob([diff]).size;
  const diffTooLarge = diffSizeBytes > MAX_DIFF_BYTES;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (diff.trim().length === 0 || diffTooLarge) return;
    void stream.run({ diff, model });
  };

  const isStreaming = stream.status === "streaming";
  const groups = stream.final ? groupFindings(stream.final.findings) : null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
      {/* ── Left: form ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card/60 p-6 backdrop-blur-sm">
        <h1 className="mb-5 flex items-center gap-2 font-semibold text-xl tracking-tight">
          <PlayCircle className="size-5 text-primary" />
          New Review
        </h1>

        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          {/* Model selector */}
          <div className="flex flex-col gap-2">
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Model
            </p>
            <ModelSelector value={model} onChange={setModel} disabled={isStreaming} />
          </div>

          {/* Diff input */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="diff"
                className="font-medium text-muted-foreground text-xs uppercase tracking-wide"
              >
                Diff
              </label>
              {diff.length > 0 && (
                <span
                  className={cn(
                    "font-mono text-[10px]",
                    diffTooLarge ? "text-red-400" : "text-muted-foreground/60",
                  )}
                >
                  {(diffSizeBytes / 1024).toFixed(0)} KB / {MAX_DIFF_BYTES / 1024} KB
                </span>
              )}
            </div>
            <Textarea
              id="diff"
              value={diff}
              onChange={(e) => setDiff(e.target.value)}
              className="min-h-[260px] font-mono text-xs leading-relaxed dark:bg-black/20"
              placeholder={"@@ -1,3 +1,3 @@\n-old line\n+new line\n context"}
              disabled={isStreaming}
            />
            {diffTooLarge && (
              <p className="text-red-400 text-xs">
                Diff exceeds the {MAX_DIFF_BYTES / 1024} KB limit. Trim it or split into smaller
                reviews.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={isStreaming || diff.trim().length === 0 || diffTooLarge}
              className="flex-1 bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-lg shadow-primary/20 hover:brightness-110 disabled:opacity-50"
            >
              {isStreaming ? (
                <span className="flex items-center gap-2">
                  <span className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Running review…
                </span>
              ) : (
                "Run Review"
              )}
            </Button>
            {isStreaming && (
              <Button type="button" variant="outline" size="icon" onClick={stream.abort}>
                <X className="size-4" />
              </Button>
            )}
          </div>
        </form>
      </div>

      {/* ── Right: output ──────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/60 p-6 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold text-base">
            <StatusDot status={stream.status} />
            Output
          </h2>
          <span className="text-muted-foreground text-xs uppercase tracking-wide">
            {stream.status}
          </span>
        </div>

        {/* Console ticker */}
        {stream.ticker.length > 0 ? (
          <div className="rounded-lg border border-white/5 bg-black/40 p-3 font-mono text-xs">
            {stream.ticker.map((line, i) => (
              <div key={`${i}-${line.slice(0, 12)}`} className="flex items-center gap-2">
                <span className="select-none text-emerald-500">›</span>
                <span className="text-emerald-400/90">{line}</span>
                {i === stream.ticker.length - 1 && isStreaming ? (
                  <span className="ml-0.5 inline-block h-2.5 w-0.5 animate-[blink_1s_step-end_infinite] bg-emerald-400" />
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {/* Tool activity */}
        <ActivityTimeline events={stream.toolEvents} />

        {/* Streaming markdown text */}
        {stream.text.length > 0 ? (
          <div className="markdown-body">
            <ReactMarkdown>{stream.text}</ReactMarkdown>
          </div>
        ) : null}

        {/* Structured findings */}
        {stream.final && groups ? (
          <div className="flex flex-col gap-4">
            {/* Summary */}
            <p className="text-foreground/90 text-sm leading-relaxed">{stream.final.summary}</p>

            {/* Grouped findings */}
            {(["critical", "major", "minor"] as const).map((sev) => {
              const items = groups[sev];
              if (items.length === 0) return null;
              return (
                <div key={sev} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={sev}>{sev}</Badge>
                    <span className="text-muted-foreground text-xs">
                      {items.length} finding{items.length > 1 ? "s" : ""}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-2">
                    {items.map((finding, i) => (
                      <FindingItem key={`${i}-${finding.summary.slice(0, 16)}`} finding={finding} />
                    ))}
                  </ul>
                </div>
              );
            })}

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-3 border-border/50 border-t pt-3 text-muted-foreground text-xs">
              <span className="capitalize">Confidence: {stream.final.confidence}</span>
              {stream.usage ? (
                <>
                  <span className="flex items-center gap-1">
                    <Timer className="size-3" />
                    {stream.usage.inputTokens.toLocaleString()} in ·{" "}
                    {stream.usage.outputTokens.toLocaleString()} out
                  </span>
                  <span className="flex items-center gap-1">
                    <Coins className="size-3" />${stream.usage.costUsd.toFixed(4)}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Error */}
        {stream.error ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/8 p-3 text-red-400 text-sm">
            {stream.error}
          </div>
        ) : null}

        {/* Idle placeholder */}
        {stream.status === "idle" && !stream.error ? (
          <p className="text-muted-foreground/50 text-sm italic">
            Output will appear here once the review starts…
          </p>
        ) : null}
      </div>
    </div>
  );
}
