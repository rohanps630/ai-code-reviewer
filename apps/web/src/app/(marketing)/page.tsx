import { Bot, Code2, GitPullRequest, Layers, Search, Zap } from "lucide-react";
import Link from "next/link";

const FEATURES = [
  {
    icon: GitPullRequest,
    title: "Pull Request Reviews",
    description: "Paste any unified diff and get a structured code review in seconds.",
  },
  {
    icon: Search,
    title: "Code-Aware Retrieval",
    description: "Hybrid BM25 + vector search surfaces relevant context from your indexed repos.",
  },
  {
    icon: Layers,
    title: "Agentic Tool Use",
    description:
      "The agent reads files, searches your codebase, and runs tests to give precise findings.",
  },
  {
    icon: Zap,
    title: "Semantic Cache",
    description: "Exact and semantic caching slash costs on repeated or similar reviews.",
  },
];

export default function MarketingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-20">
      {/* Ambient glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="-translate-x-1/2 -translate-y-1/2 absolute top-1/3 left-1/2 h-[500px] w-[700px] rounded-full bg-indigo-500/8 blur-3xl" />
        <div className="-translate-x-1/2 -translate-y-1/2 absolute top-2/3 left-1/3 h-[300px] w-[400px] rounded-full bg-violet-500/6 blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-6 text-center">
        {/* Logo mark */}
        <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-indigo-500/30 shadow-xl">
          <Bot className="size-8 text-white" />
        </div>

        {/* Headline */}
        <div className="flex flex-col gap-2">
          <h1 className="font-bold text-4xl tracking-tight sm:text-5xl">
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
              AI Code Reviewer
            </span>
          </h1>
          <p className="max-w-lg text-base text-muted-foreground sm:text-lg">
            An AI agent that reviews GitHub pull requests using code-aware retrieval, agentic tool
            use, and semantic caching.
          </p>
        </div>

        {/* CTA */}
        <div className="flex items-center gap-3">
          <Link
            href="/reviews/new"
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-5 py-2.5 font-semibold text-sm text-white shadow-indigo-500/25 shadow-lg transition-all hover:shadow-indigo-500/40 hover:brightness-110"
          >
            <Code2 className="size-4" />
            Start a Review
          </Link>
          <Link
            href="/reviews"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-2.5 font-medium text-muted-foreground text-sm transition-colors hover:border-border/80 hover:text-foreground"
          >
            Browse Reviews
          </Link>
        </div>

        {/* Feature grid */}
        <div className="mt-12 grid max-w-2xl grid-cols-1 gap-4 text-left sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card/60 p-4 backdrop-blur-sm"
            >
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="size-4 text-primary" />
              </div>
              <p className="font-medium text-sm">{title}</p>
              <p className="text-muted-foreground text-xs">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
