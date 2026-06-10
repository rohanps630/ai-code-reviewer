import type { ReviewOutput } from "@acr/agent";
import type { Finding } from "@acr/agent";
import { eq, reviews } from "@acr/db";
import type { Review } from "@acr/db";
import { ArrowLeft, Coins, GitPullRequest, RotateCcw, Timer } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DiffViewer } from "@/components/features/reviews/diff-viewer";
import { FindingItem } from "@/components/features/reviews/finding-item";
import { ReplayTimeline } from "@/components/features/reviews/replay-timeline";
import { ReviewPoller } from "@/components/features/reviews/review-poller";
import { Badge } from "@/components/ui/badge";
import { loadAgentEvents } from "@/lib/agent-events";
import { type EvidenceItem, correlateEvidence } from "@/lib/finding-evidence";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<Review["status"], "pending" | "streaming" | "completed" | "failed"> = {
  pending: "pending",
  streaming: "streaming",
  completed: "completed",
  failed: "failed",
};

function groupByKey<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const acc: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
  }
  return acc;
}

function formatCost(cost: string | null): string | null {
  if (!cost) return null;
  const n = Number.parseFloat(cost);
  if (Number.isNaN(n)) return null;
  return `$${n.toFixed(4)}`;
}

export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [review, events] = await Promise.all([loadReview(id), loadAgentEvents(id)]);
  if (!review) notFound();

  const output = review.output as ReviewOutput | null;
  const groups = output ? groupByKey(output.findings, (f: Finding) => f.severity) : null;
  const cost = formatCost(review.cost_usd);

  const findingEvidenceMap = new Map<Finding, EvidenceItem[]>();
  if (output && events) {
    const evidences = correlateEvidence(output.findings, events);
    output.findings.forEach((f, i) => findingEvidenceMap.set(f, evidences[i] ?? []));
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Auto-refresh for in-progress reviews */}
      <ReviewPoller status={review.status} />

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <GitPullRequest className="size-4 text-primary" />
          </div>
          <div>
            <h1 className="font-semibold text-xl tracking-tight">Review</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANT[review.status]}>{review.status}</Badge>
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs">
                {review.model}
              </span>
              {review.cache_status && review.cache_status !== "miss" ? (
                <Badge variant={review.cache_status}>
                  {review.cache_status === "exact" ? "exact cache" : "semantic cache"}
                </Badge>
              ) : null}
              {cost ? (
                <span className="flex items-center gap-1 text-muted-foreground text-xs">
                  <Coins className="size-3" />
                  {cost}
                </span>
              ) : null}
              {review.input_tokens || review.output_tokens ? (
                <span className="flex items-center gap-1 text-muted-foreground text-xs">
                  <Timer className="size-3" />
                  {review.input_tokens?.toLocaleString()} in ·{" "}
                  {review.output_tokens?.toLocaleString()} out
                </span>
              ) : null}
              <span className="text-muted-foreground text-xs">
                {new Date(review.created_at).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
        <RerunButton reviewId={review.id} />
      </div>

      {/* Diff */}
      <div className="flex flex-col gap-3">
        <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Diff</h2>
        <DiffViewer diff={review.diff} findings={output?.findings} />
      </div>

      {/* Replay — persisted agent run/step stream */}
      <ReplayTimeline events={events} />

      {/* Output */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/60 p-6">
        <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Output
        </h2>
        {output ? (
          <div className="flex flex-col gap-5">
            {/* Summary */}
            <p className="text-sm leading-relaxed">{output.summary}</p>

            {/* Grouped findings */}
            {(["critical", "major", "minor"] as const).map((sev) => {
              const items = groups?.[sev] ?? [];
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
                      <FindingItem
                        key={`${i}-${finding.summary.slice(0, 16)}`}
                        finding={finding as Finding}
                        evidence={findingEvidenceMap.get(finding as Finding)}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}

            <p className="text-muted-foreground text-xs">
              Confidence:{" "}
              <span
                className={cn(
                  "font-medium",
                  output.confidence === "high"
                    ? "text-emerald-400"
                    : output.confidence === "medium"
                      ? "text-amber-400"
                      : "text-muted-foreground",
                )}
              >
                {output.confidence}
              </span>
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No output yet.</p>
        )}
      </div>

      {/* Back link */}
      <Link
        href="/reviews"
        className="flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to reviews
      </Link>
    </div>
  );
}

async function loadReview(id: string): Promise<Review | null> {
  const { db } = await import("@acr/db/client");
  const rows = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
  return rows[0] ?? null;
}

function RerunButton({ reviewId }: { reviewId: string }) {
  return (
    <Link
      href={`/reviews/new?from=${encodeURIComponent(reviewId)}`}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <RotateCcw className="size-3.5" />
      Re-run
    </Link>
  );
}
