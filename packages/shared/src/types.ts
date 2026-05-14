/**
 * Shared types that cross package boundaries in AI Code Reviewer.
 *
 * Only types that are genuinely needed by multiple packages live here.
 * Don't pre-create types for features that don't exist yet.
 */

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * Discriminated union for operations that have known failure modes.
 * Use this instead of throwing for expected errors (e.g. "repo not found").
 * Throw real `Error` instances for unexpected/exceptional cases.
 *
 * @example
 * function fetchRepo(id: string): Promise<Result<Repo, "not_found" | "forbidden">> { ... }
 *
 * const result = await fetchRepo(id);
 * if (!result.ok) {
 *   if (result.error === "not_found") return Response.json({ error: "Not found" }, { status: 404 });
 * }
 * const repo = result.value;
 */
export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

// ---------------------------------------------------------------------------
// Review domain
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a code review.
 * Stored in the `reviews.status` column.
 */
export type ReviewStatus = "pending" | "streaming" | "completed" | "failed";

/**
 * Severity level for a single review finding.
 * Used in the structured review output streamed to the client.
 */
export type FindingSeverity = "critical" | "major" | "minor" | "suggestion";
