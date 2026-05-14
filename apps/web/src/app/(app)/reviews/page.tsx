import { desc, reviews } from "@acr/db";
import type { Review } from "@acr/db";
import Link from "next/link";

import { ReviewCard } from "@/components/features/reviews/review-card";
import { buttonVariants } from "@/components/ui/button";

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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-2xl tracking-tight">Reviews</h1>
        <Link href="/reviews/new" className={buttonVariants()}>
          New review
        </Link>
      </div>

      {error ? (
        <p className="text-muted-foreground text-sm">
          Could not load reviews: <code className="text-xs">{error}</code>
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No reviews yet. Start one from{" "}
          <Link href="/reviews/new" className="underline">
            /reviews/new
          </Link>
          .
        </p>
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
