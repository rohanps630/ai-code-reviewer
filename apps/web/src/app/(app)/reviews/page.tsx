import { desc, reviews } from "@acr/db";
import type { Review } from "@acr/db";
import { GitPullRequest, Plus } from "lucide-react";
import Link from "next/link";

import { ReviewCard } from "@/components/features/reviews/review-card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  let rows: Review[] = [];
  let error: string | null = null;
  try {
    rows = await loadReviews();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load reviews";
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
            <GitPullRequest className="size-4 text-primary" />
          </div>
          <div>
            <h1 className="font-semibold text-xl tracking-tight">Reviews</h1>
            {rows.length > 0 ? (
              <p className="text-muted-foreground text-xs">{rows.length} total</p>
            ) : null}
          </div>
        </div>
        <Link
          href="/reviews/new"
          className={cn(
            buttonVariants(),
            "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-md shadow-primary/20 hover:brightness-110",
          )}
        >
          <Plus className="size-3.5" />
          New review
        </Link>
      </div>

      {/* Content */}
      {error ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/8 p-4">
          <p className="text-destructive/90 text-sm">
            Could not load reviews: <code className="font-mono text-xs opacity-80">{error}</code>
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-border border-dashed py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
            <GitPullRequest className="size-5 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium text-sm">No reviews yet</p>
            <p className="mt-1 text-muted-foreground text-xs">
              Paste a diff to get your first AI code review.
            </p>
          </div>
          <Link
            href="/reviews/new"
            className={cn(
              buttonVariants({ size: "sm" }),
              "bg-gradient-to-r from-indigo-500 to-violet-600 text-white",
            )}
          >
            <Plus className="size-3.5" />
            Start a review
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id}>
              <ReviewCard review={row} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function loadReviews(): Promise<Review[]> {
  const { db } = await import("@acr/db/client");
  return db.select().from(reviews).orderBy(desc(reviews.created_at)).limit(50);
}
