"use client";

import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react";
import Link from "next/link";

export default function ReviewDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10">
        <AlertTriangle className="size-6 text-destructive" />
      </div>

      <div className="flex max-w-sm flex-col gap-1.5">
        <h2 className="font-semibold text-lg tracking-tight">Failed to load review</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          We couldn&apos;t load this review. It may have been deleted or there was a server error.
        </p>
        {error.digest && (
          <p className="mt-1 font-mono text-muted-foreground/60 text-xs">Digest: {error.digest}</p>
        )}
      </div>

      <div className="flex gap-3">
        <Link
          href="/reviews"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 font-medium text-sm shadow-sm transition-colors hover:bg-accent"
        >
          <ArrowLeft className="size-3.5" />
          All reviews
        </Link>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground text-sm shadow-sm transition-colors hover:bg-primary/90"
        >
          <RotateCcw className="size-3.5" />
          Try again
        </button>
      </div>
    </div>
  );
}
