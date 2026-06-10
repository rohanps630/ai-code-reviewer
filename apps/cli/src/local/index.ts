import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { SearchResult } from "@acr/agent";

export class LocalRetriever {
  public async search(query: string): Promise<SearchResult[]> {
    try {
      // Use git grep with line numbers and 2 lines of context.
      // Use execFileSync with array of args to avoid shell injection.
      const stdout = execFileSync("git", ["grep", "-n", "-i", "-B", "2", "-A", "2", query], {
        encoding: "utf8",
      });
      const results: SearchResult[] = [];
      let nextId = 1;

      const blocks = stdout.split("\n--\n");
      for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split("\n");
        if (lines.length === 0 || !lines[0]) continue;

        let filePath = "";
        let startLine = Number.POSITIVE_INFINITY;
        let endLine = Number.NEGATIVE_INFINITY;
        const contentLines: string[] = [];

        for (const line of lines) {
          const match = line.match(/^([^:-]+)[::-](\d+)[::-](.*)$/);
          if (match) {
            filePath = match[1] as string;
            const lineNum = Number.parseInt(match[2] as string, 10);
            startLine = Math.min(startLine, lineNum);
            endLine = Math.max(endLine, lineNum);
            contentLines.push(match[3] as string);
          }
        }

        if (filePath) {
          const content = contentLines.join("\n");
          results.push({
            chunkId: `chunk-${nextId++}`,
            documentId: `doc-${filePath}`,
            repoId: "local",
            path: filePath,
            content: content,
            contentWithContext: content,
            startLine,
            endLine,
            symbolName: null,
            symbolKind: null,
            score: 1.0,
            bm25Rank: null,
            vectorRank: null,
            rrfScore: 1.0,
          });
        }
      }

      return results;
    } catch {
      // git grep exits with 1 if no matches found
      return [];
    }
  }
}

export class LocalSqlExecutor {
  public async execute(query: unknown): Promise<unknown> {
    if (!query || typeof query !== "object" || !("queryChunks" in query)) {
      throw new Error("LocalSqlExecutor expected a Drizzle SQL object with queryChunks");
    }
    const chunks = (query as { queryChunks: unknown[] }).queryChunks;
    if (!Array.isArray(chunks)) {
      throw new Error("LocalSqlExecutor expected queryChunks array");
    }

    // Determine query type by looking at string fragments inside StringChunks
    let isReadFile = false;
    let isFindReferences = false;

    for (const c of chunks) {
      if (typeof c === "object" && c !== null && "queryChunks" in c) {
        const qc = (c as { queryChunks: unknown[] }).queryChunks;
        if (Array.isArray(qc) && qc.length > 0 && typeof qc[0] === "string") {
          const sqlStr = qc[0];
          if (sqlStr.includes("from documents d") && sqlStr.includes("string_agg(c.content")) {
            isReadFile = true;
          }
          if (sqlStr.includes("from chunks c") && sqlStr.includes("c.content_tsv @@")) {
            isFindReferences = true;
          }
        }
      }
    }

    if (isReadFile) {
      let filePath: string | null = null;
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        if (typeof c === "object" && c !== null && "queryChunks" in c) {
          const qc = (c as { queryChunks: unknown[] }).queryChunks;
          if (Array.isArray(qc) && qc.length > 0 && typeof qc[0] === "string") {
            if (qc[0].includes("where d.path = ")) {
              const nextChunk = chunks[i + 1];
              if (typeof nextChunk === "string") {
                filePath = nextChunk;
              }
              break;
            }
          }
        }
      }

      if (typeof filePath !== "string" || !filePath) {
        throw new Error("LocalSqlExecutor could not extract path for read_file");
      }

      try {
        const content = fs.readFileSync(path.join(process.cwd(), filePath), "utf8");
        const ext = path.extname(filePath).slice(1) || "txt";
        return [{ language: ext, content, chunk_count: 1 }];
      } catch (e: unknown) {
        throw new Error(
          `Failed to read file ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (isFindReferences) {
      let symbol: string | null = null;
      for (const c of chunks) {
        if (typeof c === "object" && c !== null && "queryChunks" in c) {
          const nestedChunks = (c as { queryChunks: unknown[] }).queryChunks;
          if (Array.isArray(nestedChunks)) {
            for (let j = 0; j < nestedChunks.length; j++) {
              const cur = nestedChunks[j];
              const next = nestedChunks[j + 1];
              if (typeof cur === "string" && typeof next === "string") {
                if (cur.includes("to_tsquery('english', ")) {
                  symbol = next;
                  break;
                }
              }
            }
          }
        }
        if (symbol) break;
      }

      if (typeof symbol !== "string" || !symbol) {
        throw new Error("LocalSqlExecutor could not extract symbol for find_references");
      }

      try {
        const stdout = execFileSync("git", ["grep", "-n", "-w", symbol], { encoding: "utf8" });
        const lines = stdout.split("\n");
        const results = [];
        let count = 0;
        for (const line of lines) {
          if (!line.trim()) continue;
          if (count >= 20) break; // Limit results
          const match = line.match(/^([^:]+):(\d+):(.*)$/);
          if (match) {
            results.push({
              path: match[1] as string,
              start_line: Number.parseInt(match[2] as string, 10),
              end_line: Number.parseInt(match[2] as string, 10),
              symbol_name: null,
              symbol_kind: null,
              content: match[3] as string,
            });
            count++;
          }
        }
        return results;
      } catch {
        // git grep exits with 1 if no matches found
        return [];
      }
    }

    throw new Error("LocalSqlExecutor encountered an unrecognized query shape");
  }
}
