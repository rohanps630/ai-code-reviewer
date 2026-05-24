/**
 * search_code — hybrid retrieval tool.
 *
 * ⚠️  PROTECTED FILE — see AGENTS.md § 7.
 *
 * Wraps the Phase 2 hybrid retriever (BM25 + vector + RRF + optional
 * Cohere rerank) and exposes it as a tool the agent loop can call.
 *
 * The model uses this when the diff references a symbol/module/concept
 * it wants to understand before deciding if a change is safe. The
 * tool returns chunks with `path:start-end` locations so the model
 * can quote them back in `locationHint`.
 *
 * Design notes:
 *   - Input is intentionally narrow: a query + optional repo filter +
 *     optional limit. We don't expose `candidatesPerLane` / `rrfK` /
 *     reranker toggles to the model — those are tuning knobs we
 *     control via evals, not the agent's concern.
 *   - Output strips a few internal fields (rrfScore, bm25Rank,
 *     vectorRank, embedding) — the model just needs the chunks and
 *     their locations, not retrieval provenance.
 *   - The retriever is a constructor arg (not env-resolved) so tests
 *     and the eval harness can swap it without touching this file.
 */

import { z } from "zod";

import type { SearchResult } from "../retrieval/index.js";
import type { JsonSchemaObject, Tool } from "./types.js";

const InputSchema = z.object({
  query: z.string().min(1, "query must not be empty").max(500),
  repo_id: z.string().uuid().optional(),
  limit: z.number().int().positive().max(20).optional(),
});

type SearchCodeInput = z.infer<typeof InputSchema>;

// What the model sees per hit — minimal, prompt-readable.
const HitSchema = z.object({
  path: z.string(),
  start_line: z.number().int().nonnegative(),
  end_line: z.number().int().nonnegative(),
  symbol_name: z.string().nullable(),
  symbol_kind: z.string().nullable(),
  content_with_context: z.string(),
});

const OutputSchema = z.object({
  hits: z.array(HitSchema),
});

type SearchCodeOutput = z.infer<typeof OutputSchema>;

const INPUT_JSON_SCHEMA: JsonSchemaObject = {
  type: "object",
  required: ["query"],
  properties: {
    query: {
      type: "string",
      description:
        "Natural-language or code-flavored query. Examples: 'how does the auth flow work', 'createSession', 'where do we read STRIPE_WEBHOOK_SECRET'.",
    },
    repo_id: {
      type: "string",
      description: "Optional UUID. When set, restricts search to a single connected repo.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 20,
      description:
        "Max hits to return. Default 10. Raise sparingly — recall is rarely the bottleneck.",
    },
  },
};

/** The retriever contract the tool needs. Matches the public
 *  `HybridRetriever.search` signature so callers can pass it directly. */
export interface SearchCodeRetriever {
  search: (query: string, options?: { repoId?: string; limit?: number }) => Promise<SearchResult[]>;
}

export function createSearchCodeTool(
  retriever: SearchCodeRetriever,
): Tool<SearchCodeInput, SearchCodeOutput> {
  return {
    name: "search_code",
    description:
      "Search the indexed repository with hybrid BM25 + vector retrieval. " +
      "Call this when the diff references symbols, modules, or behavior you'd " +
      "want to look up before deciding if the change is safe. Returns up to " +
      "`limit` chunks (default 10), each with file path + line range.",
    inputSchema: INPUT_JSON_SCHEMA,
    inputValidator: InputSchema,
    outputValidator: OutputSchema,
    execute: async (input) => {
      const results = await retriever.search(input.query, {
        repoId: input.repo_id,
        limit: input.limit ?? 10,
      });
      return {
        hits: results.map(toHit),
      };
    },
  };
}

function toHit(r: SearchResult): SearchCodeOutput["hits"][number] {
  return {
    path: r.path,
    start_line: r.startLine,
    end_line: r.endLine,
    symbol_name: r.symbolName,
    symbol_kind: r.symbolKind ?? null,
    content_with_context: r.contentWithContext,
  };
}
