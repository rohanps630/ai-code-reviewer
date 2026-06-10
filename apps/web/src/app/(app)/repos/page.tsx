import { repos } from "@acr/db";
import type { Repo } from "@acr/db";
import { Database, GitBranch, GitCommit, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { ConnectRepoForm } from "./connect-repo-form";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<Repo["status"], "pending" | "streaming" | "completed" | "failed"> = {
  pending: "pending",
  indexing: "streaming",
  indexed: "completed",
  failed: "failed",
};

const STATUS_LABEL: Record<Repo["status"], string> = {
  pending: "Pending",
  indexing: "Indexing…",
  indexed: "Indexed",
  failed: "Failed",
};

function RepoCard({ repo }: { repo: Repo }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/60 p-4 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Database className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-sm">
              {repo.owner}/{repo.name}
            </p>
            <a
              href={repo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-muted-foreground text-xs transition-colors hover:text-primary"
            >
              {repo.url}
            </a>
          </div>
        </div>
        <Badge variant={STATUS_VARIANT[repo.status]}>{STATUS_LABEL[repo.status]}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-border/40 border-t pt-3 text-muted-foreground text-xs">
        <span className="flex items-center gap-1">
          <GitBranch className="size-3" />
          {repo.default_branch}
        </span>
        {repo.last_indexed_commit ? (
          <span className="flex items-center gap-1 font-mono">
            <GitCommit className="size-3" />
            {repo.last_indexed_commit.slice(0, 7)}
          </span>
        ) : null}
        {repo.last_indexed_at ? (
          <span className="ml-auto">
            Indexed {new Date(repo.last_indexed_at).toLocaleDateString()}
          </span>
        ) : (
          <span className="ml-auto italic">Not yet indexed</span>
        )}
      </div>
    </div>
  );
}

export default async function ReposPage() {
  let rows: Repo[] = [];
  let error: string | null = null;
  try {
    rows = await loadRepos();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load repos";
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
          <Database className="size-4 text-primary" />
        </div>
        <div>
          <h1 className="font-semibold text-xl tracking-tight">Repos</h1>
          {rows.length > 0 ? (
            <p className="text-muted-foreground text-xs">{rows.length} connected</p>
          ) : null}
        </div>
      </div>

      {/* Error */}
      {error ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/8 p-4">
          <p className="text-destructive/90 text-sm">
            Could not load repos: <code className="font-mono text-xs opacity-80">{error}</code>
          </p>
        </div>
      ) : null}

      {/* Repo list or empty state */}
      {!error ? (
        rows.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-border border-dashed py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
              <Database className="size-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium text-sm">No repositories connected</p>
              <p className="mx-auto mt-1 max-w-xs text-muted-foreground text-xs">
                Connect a GitHub repository to enable code-aware retrieval in your reviews.
              </p>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((repo) => (
              <li key={repo.id}>
                <RepoCard repo={repo} />
              </li>
            ))}
          </ul>
        )
      ) : null}

      {/* Connect new repo */}
      <div className="rounded-xl border border-border bg-card/60 p-5">
        <h2 className="mb-1 font-medium text-sm">Connect Repository</h2>
        <p className="mb-4 text-muted-foreground text-xs">
          Add a GitHub repository to index it for context-aware reviews.
        </p>
        <ConnectRepoForm />
      </div>

      {/* Indexer note */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/15 bg-amber-500/5 p-4">
        <RefreshCw className="mt-0.5 size-4 shrink-0 text-amber-400" />
        <div>
          <p className="font-medium text-amber-300 text-sm">Indexing runs via the Python indexer</p>
          <p className="mt-0.5 text-amber-400/80 text-xs">
            After connecting a repo, run:{" "}
            <code className="font-mono">uv run python -m indexer.cli index &lt;repo-url&gt;</code>
          </p>
        </div>
      </div>
    </div>
  );
}

async function loadRepos(): Promise<Repo[]> {
  const { db } = await import("@acr/db/client");
  const { desc } = await import("@acr/db");
  return db.select().from(repos).orderBy(desc(repos.created_at)).limit(100);
}
