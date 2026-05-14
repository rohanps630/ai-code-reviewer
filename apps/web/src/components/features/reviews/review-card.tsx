import type { Review } from "@acr/db";
import Link from "next/link";

import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<Review["status"], string> = {
  pending: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  streaming: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-100",
  completed: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-100",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-100",
};

export function ReviewCard({ review }: { review: Review }) {
  return (
    <Link
      href={`/reviews/${review.id}`}
      className="block rounded-md border bg-card p-3 transition hover:bg-accent"
    >
      <div className="flex items-center gap-2 text-xs">
        <span
          className={cn(
            "rounded-sm px-1.5 py-0.5 font-medium uppercase tracking-wide",
            STATUS_STYLES[review.status],
          )}
        >
          {review.status}
        </span>
        <span className="text-muted-foreground">{review.model}</span>
        <span className="ml-auto text-muted-foreground">
          {new Date(review.created_at).toLocaleString()}
        </span>
      </div>
      <p className="mt-2 line-clamp-1 font-mono text-muted-foreground text-xs">
        {review.diff.slice(0, 100)}
      </p>
    </Link>
  );
}
