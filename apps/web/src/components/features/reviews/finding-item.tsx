"use client";

import type { Finding } from "@acr/agent";
import { Check, Copy, MapPin } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const SEVERITY_VARIANT: Record<Finding["severity"], "critical" | "major" | "minor"> = {
  critical: "critical",
  major: "major",
  minor: "minor",
};

const CATEGORY_LABELS: Record<Finding["category"], string> = {
  bug: "Bug",
  perf: "Perf",
  security: "Security",
  style: "Style",
  logic: "Logic",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
        copied
          ? "bg-emerald-500/10 text-emerald-400"
          : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
      )}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function FindingItem({ finding }: { finding: Finding }) {
  return (
    <li className="rounded-xl border border-border bg-card/40 p-4 text-sm">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={SEVERITY_VARIANT[finding.severity]}>{finding.severity}</Badge>
        <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {CATEGORY_LABELS[finding.category]}
        </span>
        {finding.locationHint ? (
          <span className="ml-auto flex items-center gap-1 font-mono text-muted-foreground/70 text-xs">
            <MapPin className="size-3 shrink-0" />
            {finding.locationHint}
          </span>
        ) : null}
      </div>

      {/* Summary */}
      <p className="mt-2.5 text-sm leading-relaxed">{finding.summary}</p>

      {/* Suggestion */}
      {finding.suggestion ? (
        <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Suggestion
            </span>
            <CopyButton text={finding.suggestion} />
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">{finding.suggestion}</p>
        </div>
      ) : null}
    </li>
  );
}
