export function DiffViewer({ diff }: { diff: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 text-xs">
      <code>
        {diff.split("\n").map((line, i) => (
          <span
            key={`${i}-${line.slice(0, 16)}`}
            className={
              line.startsWith("+")
                ? "block bg-green-500/10 text-green-900 dark:text-green-200"
                : line.startsWith("-")
                  ? "block bg-red-500/10 text-red-900 dark:text-red-200"
                  : line.startsWith("@@")
                    ? "block text-muted-foreground"
                    : "block"
            }
          >
            {line || " "}
          </span>
        ))}
      </code>
    </pre>
  );
}
