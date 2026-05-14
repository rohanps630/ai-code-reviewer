import type { ReviewOutput } from "@acr/agent";
import { eq, reviews } from "@acr/db";
import type { Review } from "@acr/db";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DiffViewer } from "@/components/features/reviews/diff-viewer";
import { FindingItem } from "@/components/features/reviews/finding-item";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const review = await loadReview(id);
  if (!review) notFound();

  const output = review.output as ReviewOutput | null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Review</h1>
          <p className="text-muted-foreground text-xs">
            {new Date(review.created_at).toLocaleString()} · {review.model} · {review.status}
          </p>
        </div>
        <RerunForm diff={review.diff} model={review.model} />
      </div>

      <Card className="flex flex-col gap-3 p-6">
        <h2 className="font-medium text-sm uppercase tracking-wide">Diff</h2>
        <DiffViewer diff={review.diff} />
      </Card>

      <Card className="flex flex-col gap-3 p-6">
        <h2 className="font-medium text-sm uppercase tracking-wide">Output</h2>
        {output ? (
          <>
            <p className="text-sm">{output.summary}</p>
            <ul className="flex flex-col gap-2">
              {output.findings.map((finding, i) => (
                <FindingItem key={`${i}-${finding.summary.slice(0, 16)}`} finding={finding} />
              ))}
            </ul>
            <p className="text-muted-foreground text-xs">Confidence: {output.confidence}</p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">No output yet.</p>
        )}
      </Card>

      <div>
        <Link href="/reviews" className="text-muted-foreground text-sm underline">
          ← Back to reviews
        </Link>
      </div>
    </div>
  );
}

async function loadReview(id: string): Promise<Review | null> {
  const { db } = await import("@acr/db/client");
  const rows = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
  return rows[0] ?? null;
}

function RerunForm({ diff, model }: { diff: string; model: string }) {
  return (
    <form
      action={`/reviews/new?diff=${encodeURIComponent(diff)}&model=${encodeURIComponent(model)}`}
    >
      <Button type="submit" variant="outline">
        Re-run
      </Button>
    </form>
  );
}
