/**
 * read_file — fetch an indexed document by path.
 *
 * ⚠️  PROTECTED FILE — see AGENTS.md § 7.
 *
 * The model uses this when it knows exactly which file it needs and
 * doesn't want to spend a search query getting there. We return all
 * chunks of the document concatenated in order, plus the file's path
 * and language. If the file isn't indexed we return `found: false`
 * so the model can self-correct (try search_code instead).
 *
 * Why not return the on-disk file bytes: the agent only sees what
 * the indexer has already chunked + embedded. Reading raw disk would
 * couple the agent to repo layout and bypass the abstraction that
 * makes Phase 4 evals reproducible.
 */

import { sql } from "@acr/db";
import { z } from "zod";

import type { JsonSchemaObject, Tool } from "./types.js";

const InputSchema = z.object({
  path: z.string().min(1).max(500),
  repo_id: z.string().uuid().optional(),
});

type ReadFileInput = z.infer<typeof InputSchema>;

const OutputSchema = z.discriminatedUnion("found", [
  z.object({
    found: z.literal(true),
    path: z.string(),
    language: z.string().nullable(),
    content: z.string(),
    chunk_count: z.number().int().nonnegative(),
  }),
  z.object({
    found: z.literal(false),
    path: z.string(),
  }),
]);

type ReadFileOutput = z.infer<typeof OutputSchema>;

const INPUT_JSON_SCHEMA: JsonSchemaObject = {
  type: "object",
  required: ["path"],
  properties: {
    path: {
      type: "string",
      description:
        "Repo-relative POSIX path, e.g. 'src/auth/login.ts'. Must match an indexed document exactly.",
    },
    repo_id: {
      type: "string",
      description:
        "Optional UUID. Required when more than one repo is indexed under the same path.",
    },
  },
};

/** Minimal contract the tool needs over @acr/db's client. Both
 *  drizzle's db and a raw postgres-js client expose `.execute(sql)`. */
export interface ReadFileExecutor {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
}

type DocumentRow = {
  document_id: string;
  language: string | null;
  content: string;
  chunk_count: string | number;
};

export function createReadFileTool(
  executor: ReadFileExecutor,
): Tool<ReadFileInput, ReadFileOutput> {
  return {
    name: "read_file",
    description:
      "Fetch the full text of an indexed file by exact path. Returns all chunks " +
      "of the document concatenated in order. Use this when you already know which " +
      "file you need (e.g. from a diff hunk header or a search_code hit). If the " +
      "file is not in the index, returns { found: false } — try search_code instead.",
    inputSchema: INPUT_JSON_SCHEMA,
    inputValidator: InputSchema,
    outputValidator: OutputSchema,
    execute: async (input) => {
      const repoFilter = input.repo_id ? sql`and d.repo_id = ${input.repo_id}::uuid` : sql``;

      const rows = (await executor.execute(sql`
        select
          d.id        as document_id,
          d.language  as language,
          string_agg(c.content, E'\n' order by c.chunk_index) as content,
          count(c.id) as chunk_count
        from documents d
        left join chunks c on c.document_id = d.id
        where d.path = ${input.path}
          ${repoFilter}
        group by d.id, d.language
        limit 1
      `)) as unknown as DocumentRow[];

      const row = rows[0];
      if (!row) {
        return { found: false, path: input.path };
      }

      return {
        found: true,
        path: input.path,
        language: row.language,
        content: row.content ?? "",
        chunk_count:
          typeof row.chunk_count === "string" ? Number(row.chunk_count) : row.chunk_count,
      };
    },
  };
}
