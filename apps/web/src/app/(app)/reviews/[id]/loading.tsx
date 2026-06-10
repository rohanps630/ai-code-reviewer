export default function ReviewDetailLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Back link skeleton */}
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />

      {/* Header skeleton */}
      <div className="flex flex-col gap-3">
        <div className="h-7 w-64 animate-pulse rounded bg-muted" />
        <div className="flex gap-2">
          <div className="h-6 w-20 animate-pulse rounded-full bg-muted" />
          <div className="h-6 w-16 animate-pulse rounded-full bg-muted" />
          <div className="h-6 w-24 animate-pulse rounded-full bg-muted" />
        </div>
      </div>

      {/* Summary card skeleton */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 h-5 w-20 animate-pulse rounded bg-muted" />
        <div className="flex flex-col gap-2">
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
          <div className="h-4 w-4/6 animate-pulse rounded bg-muted" />
        </div>
      </div>

      {/* Findings skeleton */}
      <div className="flex flex-col gap-3">
        <div className="h-5 w-20 animate-pulse rounded bg-muted" />
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={`finding-skeleton-${i.toString()}`}
            className="rounded-xl border border-border bg-card p-4"
          >
            <div className="mb-2 flex items-center gap-2">
              <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
              <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
