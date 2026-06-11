/**
 * find_references — find call sites + references to a symbol.
 *
 * ⚠️  PROTECTED FILE — see AGENTS.md § 7.
 *
 * The model uses this to assess blast radius before declaring a change
 * safe. ("If I rename `createSession`, what else needs to change?")
 *
 * v1 implementation: BM25-only search restricted to literal symbol
 * matches via Postgres's `to_tsquery` with a phrase query. This is
 * cheap, deterministic, and works without a real LSP. It will produce
 * false positives on common names (e.g. `id`, `get`) — the input
 * validator enforces a minimum length to soften that.
 *
 * The proper version (Phase 3+ refinement) would use tree-sitter to
 * resolve actual references; that's a bigger ask and lands when evals
 * tell us the BM25 approximation is hurting recall.
 */

import { z } from "zod";

import type { CodeSource, ReferenceResult } from "./code-source.js";
import type { JsonSchemaObject, Tool } from "./types.js";

const InputSchema = z.object({
  symbol: z
    .string()
    .min(3, "symbol must be at least 3 chars to avoid noise matches")
    .max(120)
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, "symbol must look like an identifier"),
  repo_id: z.string().uuid().optional(),
  limit: z.number().int().positive().max(50).optional(),
});

type FindReferencesInput = z.infer<typeof InputSchema>;

const ReferenceSchema = z.object({
  path: z.string(),
  start_line: z.number().int().nonnegative(),
  end_line: z.number().int().nonnegative(),
  symbol_name: z.string().nullable(),
  symbol_kind: z.string().nullable(),
  snippet: z.string(),
});

const OutputSchema = z.object({
  symbol: z.string(),
  references: z.array(ReferenceSchema),
});

type FindReferencesOutput = z.infer<typeof OutputSchema>;

const INPUT_JSON_SCHEMA: JsonSchemaObject = {
  type: "object",
  required: ["symbol"],
  properties: {
    symbol: {
      type: "string",
      description:
        "Identifier to search for (function/class/variable name). Must be >=3 chars and match /^[A-Za-z_$][A-Za-z0-9_$]*$/.",
    },
    repo_id: {
      type: "string",
      description: "Optional UUID. Restricts search to one indexed repo.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 50,
      description: "Max references to return. Default 20.",
    },
  },
};

/**
 * Creates a tool to find symbol cross-references via BM25 search.
 *
 * @param codeSource - The source for finding references.
 * @returns A Tool instance configured to find symbol references.
 *
 * @example
 * const findRefsTool = createFindReferencesTool(codeSource);
 */
export function createFindReferencesTool(
  codeSource: CodeSource,
): Tool<FindReferencesInput, FindReferencesOutput> {
  return {
    name: "find_references",
    description:
      "Find places that reference a given symbol across the indexed repo. " +
      "Returns chunks where the symbol appears, with file + line range + a " +
      "trimmed snippet. Use this to assess blast radius before approving a " +
      "rename or signature change. Implementation is text-based (BM25), so " +
      "false positives are possible for common names — the symbol must be " +
      "at least 3 chars and look like an identifier.",
    inputSchema: INPUT_JSON_SCHEMA,
    inputValidator: InputSchema,
    outputValidator: OutputSchema,
    execute: async (input) => {
      const limit = input.limit ?? 20;
      const rows = await codeSource.findReferences(input.symbol, limit, input.repo_id);

      return {
        symbol: input.symbol,
        references: rows.map(toReference),
      };
    },
  };
}

function toReference(row: ReferenceResult): FindReferencesOutput["references"][number] {
  // Trim the snippet to ~10 lines around the first occurrence so the
  // prompt doesn't blow up when a chunk is huge.
  const snippet = trimAroundSymbol(row.content);
  return {
    path: row.path,
    start_line: row.start_line,
    end_line: row.end_line,
    symbol_name: row.symbol_name,
    symbol_kind: row.symbol_kind,
    snippet,
  };
}

function trimAroundSymbol(content: string): string {
  const lines = content.split("\n");
  if (lines.length <= 12) return content;
  return `${lines.slice(0, 12).join("\n")}\n…`;
}
