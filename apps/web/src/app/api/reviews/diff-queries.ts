/**
 * Turn a unified diff into a small set of retrieval queries.
 *
 * The retrieval lane decides which chunks the reviewer sees. We want
 * those chunks to be _about_ the change, so the queries we feed
 * `searchCode()` need to extract real signal from the diff:
 *
 *   1. File paths from the diff headers (`diff --git a/X b/Y`).
 *   2. Symbol names from hunk headers (`@@ -L,N +L,N @@ <signature>`).
 *   3. Identifier-looking tokens added or removed in body lines.
 *   4. A short "what does this PR do?" summary line built from the
 *      file paths so we always have one general-purpose query.
 *
 * Pure function. No I/O. No LLM call. Easy to unit test.
 *
 * v1 heuristics, deliberately simple. Evals (Phase 4) will tell us
 * which signals actually move recall and which are noise.
 */

const MAX_QUERIES_DEFAULT = 5;
const MAX_QUERY_LENGTH = 120;

// Reject stop-word-y / TypeScript / generic-noise tokens that would
// drown out the real symbols. Tuned by feel; revisit when we have
// retrieval recall numbers.
const STOP_TOKENS = new Set([
  "const",
  "let",
  "var",
  "function",
  "class",
  "return",
  "import",
  "export",
  "from",
  "if",
  "else",
  "for",
  "while",
  "true",
  "false",
  "null",
  "undefined",
  "this",
  "new",
  "async",
  "await",
  "void",
  "any",
  "string",
  "number",
  "boolean",
  "type",
  "interface",
  "default",
]);

const IDENTIFIER_RE = /[A-Za-z_$][A-Za-z0-9_$]{2,}/g;

export type ExtractOptions = {
  /** Cap returned query count (default 5). */
  maxQueries?: number;
};

/** Extract a deduped, length-capped list of search queries from a diff. */
export function extractQueries(diff: string, options: ExtractOptions = {}): string[] {
  const maxQueries = options.maxQueries ?? MAX_QUERIES_DEFAULT;
  if (!diff.trim()) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  const push = (q: string | undefined | null): void => {
    if (!q) return;
    const trimmed = q.trim().slice(0, MAX_QUERY_LENGTH);
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  const lines = diff.split(/\r?\n/);
  const paths: string[] = [];

  for (const line of lines) {
    // 1. File paths
    //    "diff --git a/src/auth/login.ts b/src/auth/login.ts"
    const fileMatch = /^diff --git a\/(\S+) b\/(\S+)/.exec(line);
    if (fileMatch?.[2]) {
      paths.push(fileMatch[2]);
      continue;
    }

    // 2. Hunk-header signatures
    //    "@@ -10,5 +10,5 @@ export function login(req: Request) {"
    const hunkMatch = /^@@[^@]*@@\s*(.+)$/.exec(line);
    if (hunkMatch?.[1]) {
      push(hunkMatch[1]);
    }
  }

  // 3. File paths as queries (one each, plus a single overview)
  for (const p of paths) push(p);
  if (paths.length > 0) {
    push(`changes to ${paths.slice(0, 3).join(", ")}`);
  }

  // 4. Identifier tokens on +/- body lines (not headers)
  const bodyTokens = new Set<string>();
  for (const line of lines) {
    if (!/^[+-]/.test(line)) continue;
    if (/^(\+\+\+|---)/.test(line)) continue; // skip file headers
    const body = line.slice(1);
    for (const tok of body.match(IDENTIFIER_RE) ?? []) {
      const lower = tok.toLowerCase();
      if (STOP_TOKENS.has(lower)) continue;
      if (tok.length < 3) continue;
      bodyTokens.add(tok);
    }
  }

  // Promote multi-token strings up to the cap. We deliberately keep
  // each identifier as its own query rather than concatenating them —
  // RRF across multiple narrow queries beats one fat query for code.
  for (const tok of bodyTokens) {
    if (out.length >= maxQueries) break;
    push(tok);
  }

  return out.slice(0, maxQueries);
}
