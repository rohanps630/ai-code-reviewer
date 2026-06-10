"use client";

import type { Finding } from "@acr/agent";
import { Check, ChevronDown, Copy, FileSearch, MapPin } from "lucide-react";
import { useState } from "react";

import type { EvidenceItem } from "@/lib/finding-evidence";

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

function EvidenceSection({ evidence }: { evidence?: EvidenceItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 rounded-lg border border-border/50 bg-muted/10">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-3 text-left font-medium text-muted-foreground text-xs transition-colors hover:text-foreground"
      >
        <span className="flex items-center gap-1.5">
          <FileSearch className="size-3.5" />
          Evidence
          <Badge variant="outline" className="ml-1 h-4 border-border/50 px-1.5 text-[10px]">
            {evidence ? evidence.length : 0}
          </Badge>
        </span>
        <ChevronDown
          className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="border-border/30 border-t p-3 text-xs">
          {!evidence || evidence.length === 0 ? (
            <p className="text-muted-foreground italic">no recorded evidence for this finding</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {evidence.map((item) => (
                <li
                  key={item.toolEventIndex}
                  className="flex flex-col gap-1.5 rounded-md border border-border/40 bg-muted/20 p-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {item.path}
                      {item.startLine
                        ? `:${item.startLine}${item.endLine && item.endLine !== item.startLine ? `-${item.endLine}` : ""}`
                        : ""}
                    </span>
                    <a
                      href={`#event-${item.toolEventIndex}`}
                      className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary hover:underline"
                    >
                      {item.toolName}
                    </a>
                  </div>
                  {item.snippet && (
                    <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded bg-black/40 p-2 font-mono text-[10px] text-muted-foreground/90">
                      {item.snippet}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function FindingItem({
  finding,
  evidence,
}: { finding: Finding; evidence?: EvidenceItem[] }) {
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

      {/* Evidence */}
      <EvidenceSection evidence={evidence} />
    </li>
  );
}
