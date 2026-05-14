/**
 * Public interface types for @acr/agent.
 *
 * These types define the contract between the agent package and its
 * consumers (apps/web, tests). They will NOT change without an ADR.
 *
 * Consumers should import from "@acr/agent/types" or "@acr/agent".
 */

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type ReviewInput = {
  diff: string;
  /** Which model to use. Phase 5 router populates this; defaults to sonnet. */
  model?: "haiku" | "sonnet" | "opus";
  /** Repo metadata. Phase 2 fills this from the connected GitHub repo. */
  repoContext?: {
    owner: string;
    repo: string;
    defaultBranch: string;
  };
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type Finding = {
  category: "bug" | "perf" | "security" | "style" | "logic";
  severity: "critical" | "major" | "minor";
  summary: string;
  /** File path and/or line range hint, e.g. "src/auth.ts:42". Optional. */
  locationHint?: string;
  /** Concrete fix suggestion. Optional. */
  suggestion?: string;
};

export type ReviewOutput = {
  summary: string;
  findings: Finding[];
  confidence: "high" | "medium" | "low";
};

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/**
 * Discriminated union of chunks emitted by the agent as it works.
 * The UI renders each chunk type differently:
 *   - status      → progress indicator
 *   - tool_call   → tool sidebar entry (Phase 3)
 *   - tool_result → tool sidebar result (Phase 3)
 *   - text        → streamed markdown in the main column
 *   - final       → complete structured output, ends the stream
 */
export type ReviewChunk =
  | { type: "status"; message: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: unknown }
  | { type: "text"; delta: string }
  | { type: "final"; output: ReviewOutput };
