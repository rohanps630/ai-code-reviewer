import { count, desc, reviews } from "@acr/db";
import type { Review } from "@acr/db";
import { ChevronLeft, ChevronRight, GitPullRequest, Plus } from "lucide-react";
import Link from "next/link";

import { ReviewCard } from "@/components/features/reviews/review-card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const rawPage = typeof params.page === "string" ? Number.parseInt(params.page, 10) : 1;
  const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

  let rows: Review[] = [];
  let total = 0;
  let error: string | null = null;
  try {
    const result = await loadReviews(page);
    rows = result.rows;
    total = result.total;
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load reviews";
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

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
            {total > 0 ? (
              <p className="text-muted-foreground text-xs">
                {total} total · page {page} of {totalPages}
              </p>
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
      ) : rows.length === 0 && page === 1 ? (
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
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.id}>
                <ReviewCard review={row} />
              </li>
            ))}
          </ul>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              {hasPrev ? (
                <Link
                  href={`/reviews?page=${page - 1}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1")}
                >
                  <ChevronLeft className="size-3.5" />
                  Previous
                </Link>
              ) : (
                <span
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "pointer-events-none gap-1 opacity-40",
                  )}
                >
                  <ChevronLeft className="size-3.5" />
                  Previous
                </span>
              )}

              <span className="px-2 text-muted-foreground text-xs">
                {page} / {totalPages}
              </span>

              {hasNext ? (
                <Link
                  href={`/reviews?page=${page + 1}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1")}
                >
                  Next
                  <ChevronRight className="size-3.5" />
                </Link>
              ) : (
                <span
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "pointer-events-none gap-1 opacity-40",
                  )}
                >
                  Next
                  <ChevronRight className="size-3.5" />
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

async function loadReviews(page: number): Promise<{ rows: Review[]; total: number }> {
  const { db } = await import("@acr/db/client");
  const offset = (page - 1) * PAGE_SIZE;
  const [rows, totalResult] = await Promise.all([
    db.select().from(reviews).orderBy(desc(reviews.created_at)).limit(PAGE_SIZE).offset(offset),
    db.select({ value: count() }).from(reviews),
  ]);
  return { rows, total: totalResult[0]?.value ?? 0 };
}
