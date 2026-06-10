import type { Finding } from "@acr/agent";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-muted-foreground";
  if (line.startsWith("+"))
    return "bg-emerald-500/10 text-emerald-300 dark:bg-emerald-500/8 dark:text-emerald-300";
  if (line.startsWith("-")) return "bg-red-500/10 text-red-300 dark:bg-red-500/8 dark:text-red-300";
  if (line.startsWith("@@")) return "bg-blue-500/5 text-blue-400/80";
  if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("new file"))
    return "text-muted-foreground/60";
  return "text-foreground/80";
}

type ParsedFile = {
  path: string;
  lines: string[];
};

function parseDiff(diff: string): ParsedFile[] {
  const lines = diff.split("\n");
  const files: ParsedFile[] = [];
  let currentFile: ParsedFile | null = null;

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      const path = match?.[2] ?? "unknown";
      currentFile = { path, lines: [line] };
      files.push(currentFile);
    } else if (currentFile) {
      currentFile.lines.push(line);
    } else {
      if (!currentFile) {
        currentFile = { path: "unknown", lines: [] };
        files.push(currentFile);
      }
      currentFile.lines.push(line);
    }
  }

  return files;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "border-red-500/50 bg-red-500/10",
  major: "border-orange-500/50 bg-orange-500/10",
  minor: "border-blue-500/50 bg-blue-500/10",
  suggestion: "border-emerald-500/50 bg-emerald-500/10",
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  major: 3,
  minor: 2,
  suggestion: 1,
};

export function DiffViewer({ diff, findings = [] }: { diff: string; findings?: Finding[] }) {
  const files = parseDiff(diff);

  return (
    <div className="flex flex-col gap-4">
      {files.map((file, i) => {
        const fileFindings = findings.filter((f) => {
          if (!f.locationHint) return false;
          const path = f.locationHint.split(":")[0];
          return path === file.path;
        });

        const highestSeverity =
          fileFindings.length > 0
            ? fileFindings.reduce(
                (max, f) =>
                  (SEVERITY_RANK[f.severity] || 0) > (SEVERITY_RANK[max] || 0) ? f.severity : max,
                fileFindings[0]?.severity as Finding["severity"],
              )
            : null;

        const containerColor = highestSeverity
          ? SEVERITY_COLORS[highestSeverity]
          : "border-border bg-black/30";

        return (
          <div
            key={`${i}-${file.path}`}
            className={cn("overflow-hidden rounded-xl border", containerColor)}
          >
            <div className="flex flex-wrap items-center justify-between border-border/50 border-b bg-muted/20 px-4 py-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-muted-foreground text-xs">{file.path}</span>
                {highestSeverity && (
                  <Badge
                    variant={
                      highestSeverity === "critical" || highestSeverity === "major"
                        ? "destructive"
                        : "secondary"
                    }
                    className="h-4 px-1.5 text-[10px]"
                  >
                    {fileFindings.length} finding{fileFindings.length === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
              <span className="text-muted-foreground text-xs">{file.lines.length} lines</span>
            </div>
            <div className="overflow-x-auto">
              <pre className="font-mono text-xs leading-relaxed">
                {file.lines.map((line, j) => (
                  <div
                    key={`${j}-${line.slice(0, 8)}`}
                    className={cn("flex min-w-0", lineClass(line))}
                  >
                    <span className="w-10 shrink-0 select-none border-white/5 border-r pr-3 text-right font-mono text-muted-foreground/30">
                      {j + 1}
                    </span>
                    <code className="flex-1 whitespace-pre px-3">{line || " "}</code>
                  </div>
                ))}
              </pre>
            </div>
          </div>
        );
      })}
    </div>
  );
}
