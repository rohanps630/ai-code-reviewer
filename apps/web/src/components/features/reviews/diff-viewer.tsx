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

export function DiffViewer({ diff }: { diff: string }) {
  const lines = diff.split("\n");

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-black/30">
      <div className="flex items-center justify-between border-border/50 border-b bg-muted/20 px-4 py-2">
        <span className="font-mono text-muted-foreground text-xs">diff</span>
        <span className="text-muted-foreground text-xs">{lines.length} lines</span>
      </div>
      <div className="overflow-x-auto">
        <pre className="font-mono text-xs leading-relaxed">
          {lines.map((line, i) => (
            <div key={`${i}-${line.slice(0, 8)}`} className={cn("flex min-w-0", lineClass(line))}>
              <span className="w-10 shrink-0 select-none border-white/5 border-r pr-3 text-right font-mono text-muted-foreground/30">
                {i + 1}
              </span>
              <code className="flex-1 whitespace-pre px-3">{line || " "}</code>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
