import { sql } from "@acr/db";
import type { CodeSource, FileResult, ReferenceResult } from "./code-source.js";

type DocumentRow = {
  document_id: string;
  language: string | null;
  content: string;
  chunk_count: string | number;
};

type ReferenceRow = {
  path: string;
  start_line: number;
  end_line: number;
  symbol_name: string | null;
  symbol_kind: string | null;
  content: string;
};

export class PostgresCodeSource implements CodeSource {
  constructor(private executor: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> }) {}

  async readFile(path: string, repoId?: string): Promise<FileResult> {
    const repoFilter = repoId ? sql`and d.repo_id = ${repoId}::uuid` : sql``;

    const rows = (await this.executor.execute(sql`
      select
        d.id        as document_id,
        d.language  as language,
        string_agg(c.content, E'\n' order by c.chunk_index) as content,
        count(c.id) as chunk_count
      from documents d
      left join chunks c on c.document_id = d.id
      where d.path = ${path}
        ${repoFilter}
      group by d.id, d.language
      limit 1
    `)) as unknown as DocumentRow[];

    const row = rows[0];
    if (!row) {
      return { found: false };
    }

    const rawCount = Number(row.chunk_count);
    return {
      found: true,
      language: row.language,
      content: row.content,
      chunk_count: Number.isFinite(rawCount) && rawCount >= 0 ? rawCount : 0,
    };
  }

  async findReferences(symbol: string, limit: number, repoId?: string): Promise<ReferenceResult[]> {
    const repoFilter = repoId ? sql`and c.repo_id = ${repoId}::uuid` : sql``;
    // plainto_tsquery (not to_tsquery): symbols like `AuthService.login`,
    // `router.get('/')`, or `foo && bar` contain tsquery operators that make
    // to_tsquery raise a syntax error. plainto_tsquery treats the input as
    // free text and ANDs the lexemes, which never throws on user symbols.
    // Kept consistent with retrieval/bm25.ts.
    const tsq = sql`plainto_tsquery('english', ${symbol})`;

    const rows = (await this.executor.execute(sql`
      select
        d.path        as path,
        c.start_line  as start_line,
        c.end_line    as end_line,
        c.symbol_name as symbol_name,
        c.symbol_kind as symbol_kind,
        c.content     as content
      from chunks c
      join documents d on d.id = c.document_id
      where c.content_tsv @@ ${tsq}
        ${repoFilter}
      order by ts_rank_cd(c.content_tsv, ${tsq}) desc
      limit ${limit}
    `)) as unknown as ReferenceRow[];

    return rows.map((r) => ({ ...r }));
  }
}
