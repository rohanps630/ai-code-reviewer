import { eq, reviews } from "@acr/db";
import type { Review } from "@acr/db";

import { NewReviewForm } from "./form";

export const dynamic = "force-dynamic";

/** Load a previous review's diff + model for the re-run flow. */
async function loadSourceReview(id: string): Promise<Pick<Review, "diff" | "model"> | null> {
  try {
    const { db } = await import("@acr/db/client");
    const rows = await db
      .select({ diff: reviews.diff, model: reviews.model })
      .from(reviews)
      .where(eq(reviews.id, id))
      .limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function NewReviewPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const fromId = typeof params.from === "string" ? params.from : undefined;

  let initialDiff: string | undefined;
  let initialModel: string | undefined;

  if (fromId) {
    const source = await loadSourceReview(fromId);
    if (source) {
      initialDiff = source.diff;
      initialModel = source.model;
    }
  }

  return <NewReviewForm initialDiff={initialDiff} initialModel={initialModel} />;
}
