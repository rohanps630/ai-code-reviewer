export default function MarketingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="font-bold text-4xl tracking-tight">AI Code Reviewer</h1>
      <p className="max-w-md text-center text-muted-foreground">
        AI agent that reviews GitHub pull requests using code-aware retrieval and tool use.
      </p>
      <a
        href="/reviews"
        className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90"
      >
        Open App
      </a>
    </main>
  );
}
