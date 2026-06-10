import type { Review } from "@acr/db";
import { Coins, Timer } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_VARIANT: Record<Review["status"], "pending" | "streaming" | "completed" | "failed"> = {
  pending: "pending",
  streaming: "streaming",
  completed: "completed",
  failed: "failed",
};

const CACHE_VARIANT: Record<NonNullable<Review["cache_status"]>, "exact" | "semantic" | "miss"> = {
  exact: "exact",
  semantic: "semantic",
  miss: "miss",
};

function formatCost(cost: string | null): string | null {
  if (!cost) return null;
  const n = Number.parseFloat(cost);
  if (Number.isNaN(n)) return null;
  if (n < 0.001) return "<$0.001";
  return `$${n.toFixed(4)}`;
}

function formatTokens(n: number | null): string | null {
  if (n === null || n === undefined) return null;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function ReviewCard({ review }: { review: Review }) {
  const cost = formatCost(review.cost_usd);
  const inputTok = formatTokens(review.input_tokens);
  const outputTok = formatTokens(review.output_tokens);

  return (
    <Link
      href={`/reviews/${review.id}`}
      className={cn(
        "group block rounded-xl border border-border bg-card/60 p-4 backdrop-blur-sm",
        "transition-all duration-150 hover:border-primary/20 hover:bg-card hover:shadow-md hover:shadow-primary/5",
      )}
    >
      {/* Top row: status + model + date */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[review.status]}>{review.status}</Badge>

        <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs">
          {review.model}
        </span>

        {review.cache_status && review.cache_status !== "miss" ? (
          <Badge variant={CACHE_VARIANT[review.cache_status]}>
            {review.cache_status === "exact" ? "exact cache" : "semantic cache"}
          </Badge>
        ) : null}

        <span className="ml-auto text-muted-foreground text-xs">
          {new Date(review.created_at).toLocaleString()}
        </span>
      </div>

      {/* Diff preview */}
      <p className="mt-2.5 line-clamp-1 font-mono text-muted-foreground/70 text-xs">
        {review.diff.slice(0, 120)}
      </p>

      {/* Bottom row: cost + tokens */}
      {(cost ?? inputTok ?? outputTok) ? (
        <div className="mt-3 flex items-center gap-3 border-border/50 border-t pt-2.5">
          {cost ? (
            <span className="flex items-center gap-1 text-muted-foreground text-xs">
              <Coins className="size-3" />
              {cost}
            </span>
          ) : null}
          {inputTok || outputTok ? (
            <span className="flex items-center gap-1 text-muted-foreground text-xs">
              <Timer className="size-3" />
              {inputTok ? `${inputTok} in` : null}
              {inputTok && outputTok ? " · " : null}
              {outputTok ? `${outputTok} out` : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}
