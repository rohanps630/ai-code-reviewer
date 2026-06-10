import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export class LocalRetriever {
  // biome-ignore lint/suspicious/noExplicitAny: mock
  public async search(query: string): Promise<any[]> {
    // Escape query for git grep
    const escapedQuery = query.replace(/"/g, '\\"');
    try {
      // Use git grep with line numbers and 2 lines of context
      const stdout = execSync(`git grep -n -i -B 2 -A 2 "${escapedQuery}"`, { encoding: "utf8" });
      const results: Record<string, { start_line: number; end_line: number; content: string }[]> =
        {};

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
          if (!results[filePath]) {
            results[filePath] = [];
          }
          results[filePath]?.push({
            start_line: startLine,
            end_line: endLine,
            content: contentLines.join("\n"),
          });
        }
      }

      const searchResults = Object.entries(results).map(([filePath, chunks]) => {
        return {
          path: filePath,
          score: 1.0,
          chunks: chunks.map((c) => ({
            start_line: c.start_line,
            end_line: c.end_line,
            content: c.content,
            symbol_name: null,
            symbol_kind: null,
            score: 1.0,
          })),
        };
      });

      return searchResults;
    } catch {
      // git grep exits with 1 if no matches found
      return [];
    }
  }
}

export class LocalSqlExecutor {
  public async execute(query: unknown): Promise<unknown> {
    const qStr = JSON.stringify(query);

    // Distinguish read_file vs find_references
    if (
      (qStr.includes("from documents d") && qStr.includes("read_file")) ||
      qStr.includes("string_agg(c.content")
    ) {
      // read_file
      // Extract path
      let filePath = "";
      for (const c of (query as { queryChunks: unknown[] }).queryChunks) {
        if (typeof c === "string" && !c.includes("\n")) {
          filePath = c;
          break;
        }
      }

      if (!filePath) {
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
    } else if (
      qStr.includes("from chunks c") ||
      qStr.includes("find_references") ||
      qStr.includes("to_tsquery")
    ) {
      // find_references
      // Extract symbol
      let symbol = "";
      for (const c of (query as { queryChunks: unknown[] }).queryChunks) {
        const chunk = c as { queryChunks?: unknown[] } | null;
        if (chunk?.queryChunks && chunk.queryChunks.length > 1) {
          symbol = chunk.queryChunks[1] as string;
          break;
        }
      }

      if (!symbol) {
        throw new Error("LocalSqlExecutor could not extract symbol for find_references");
      }

      try {
        const escapedSymbol = symbol.replace(/"/g, '\\"');
        const stdout = execSync(`git grep -n -w "${escapedSymbol}"`, { encoding: "utf8" });
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

    throw new Error("LocalSqlExecutor encountered an unsupported query");
  }
}
