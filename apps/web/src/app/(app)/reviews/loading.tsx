export default function ReviewsLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="size-8 animate-pulse rounded-lg bg-muted" />
          <div className="flex flex-col gap-1.5">
            <div className="h-5 w-24 animate-pulse rounded bg-muted" />
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
      </div>

      {/* Card skeletons */}
      <ul className="flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={`skeleton-${i.toString()}`}>
            <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
              <div className="size-9 shrink-0 animate-pulse rounded-lg bg-muted" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              </div>
              <div className="h-6 w-16 shrink-0 animate-pulse rounded-full bg-muted" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
