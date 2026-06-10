export default function NewReviewLoading() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
      {/* ── Left: form skeleton ─────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card/60 p-6">
        {/* Heading */}
        <div className="mb-5 flex items-center gap-2">
          <div className="size-5 animate-pulse rounded bg-muted" />
          <div className="h-6 w-28 animate-pulse rounded bg-muted" />
        </div>

        <div className="flex flex-col gap-5">
          {/* Model selector label */}
          <div className="flex flex-col gap-2">
            <div className="h-3 w-12 animate-pulse rounded bg-muted" />

            {/* Model option cards (2×2 grid) */}
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 4 }, (_, i) => (
                <div
                  key={`model-skeleton-${i.toString()}`}
                  className="flex flex-col gap-1.5 rounded-xl border border-border bg-card/40 p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="size-3.5 animate-pulse rounded bg-muted" />
                      <div className="h-4 w-14 animate-pulse rounded bg-muted" />
                    </div>
                    <div className="h-4 w-10 animate-pulse rounded-full bg-muted" />
                  </div>
                  <div className="h-3 w-full animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          </div>

          {/* Diff textarea label + area */}
          <div className="flex flex-col gap-2">
            <div className="h-3 w-8 animate-pulse rounded bg-muted" />
            <div className="min-h-[260px] animate-pulse rounded-lg border border-border bg-muted/40" />
          </div>

          {/* Submit button */}
          <div className="h-10 w-full animate-pulse rounded-lg bg-muted" />
        </div>
      </div>

      {/* ── Right: output skeleton ──────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card/60 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-2 animate-pulse rounded-full bg-muted" />
            <div className="h-5 w-14 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-3 w-10 animate-pulse rounded bg-muted" />
        </div>

        <div className="mt-4 h-4 w-3/4 animate-pulse rounded bg-muted/40" />
      </div>
    </div>
  );
}
