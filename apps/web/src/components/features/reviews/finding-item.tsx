import type { Finding } from "@acr/agent";

import { cn } from "@/lib/utils";

const SEVERITY_STYLES: Record<Finding["severity"], string> = {
  critical: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
  major: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  minor: "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100",
};

export function FindingItem({ finding }: { finding: Finding }) {
  return (
    <li className="rounded-md border bg-card p-3 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "rounded-sm px-1.5 py-0.5 font-medium text-xs uppercase tracking-wide",
            SEVERITY_STYLES[finding.severity],
          )}
        >
          {finding.severity}
        </span>
        <span className="text-muted-foreground text-xs uppercase tracking-wide">
          {finding.category}
        </span>
        {finding.locationHint ? (
          <code className="ml-auto rounded bg-muted px-1.5 py-0.5 text-xs">
            {finding.locationHint}
          </code>
        ) : null}
      </div>
      <p className="mt-2">{finding.summary}</p>
      {finding.suggestion ? (
        <p className="mt-2 text-muted-foreground">{finding.suggestion}</p>
      ) : null}
    </li>
  );
}
