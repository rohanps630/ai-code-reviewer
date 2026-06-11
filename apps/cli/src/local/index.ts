import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { CodeSource, FileResult, ReferenceResult, SearchResult } from "@acr/agent";

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

/**
 * Local implementation of CodeSource using `fs` and `git grep`.
 */
export class LocalCodeSource implements CodeSource {
  async readFile(filePath: string, _repoId?: string): Promise<FileResult> {
    try {
      const content = fs.readFileSync(path.join(process.cwd(), filePath), "utf8");
      const ext = path.extname(filePath).slice(1) || "txt";
      return { found: true, language: ext, content, chunk_count: 1 };
    } catch {
      return { found: false };
    }
  }

  async findReferences(
    symbol: string,
    limit: number,
    _repoId?: string,
  ): Promise<ReferenceResult[]> {
    try {
      const stdout = execFileSync("git", ["grep", "-n", "-w", symbol], { encoding: "utf8" });
      const lines = stdout.split("\n");
      const results: ReferenceResult[] = [];
      let count = 0;
      for (const line of lines) {
        if (!line.trim()) continue;
        if (count >= limit) break;
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
      return [];
    }
  }
}
