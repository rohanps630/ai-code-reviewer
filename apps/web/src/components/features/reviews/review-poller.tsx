"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Auto-refresh the review detail page while the review is in-progress.
 * Uses `router.refresh()` to re-fetch server data every 5 seconds.
 */
export function ReviewPoller({ status }: { status: string }) {
  const router = useRouter();

  useEffect(() => {
    if (status !== "pending" && status !== "streaming") return;

    const interval = setInterval(() => {
      router.refresh();
    }, 5_000);

    return () => clearInterval(interval);
  }, [status, router]);

  if (status !== "pending" && status !== "streaming") return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-amber-400 text-xs">
      <span className="size-2 animate-pulse rounded-full bg-amber-400" />
      Review is {status}… auto-refreshing every 5s
    </div>
  );
}
