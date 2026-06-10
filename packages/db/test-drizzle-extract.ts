import { sql } from "drizzle-orm";

function extractSqlSegments(chunk: unknown, sqlSegments: string[], params: unknown[]) {
  if (typeof chunk === "string" || typeof chunk === "number" || typeof chunk === "boolean") {
    params.push(chunk);
  } else if (chunk && typeof chunk === "object") {
    const c = chunk as Record<string, unknown>;
    if (Array.isArray(c.queryChunks)) {
      for (const child of c.queryChunks) {
        if (typeof child === "string") {
          sqlSegments.push(child);
        } else {
          extractSqlSegments(child, sqlSegments, params);
        }
      }
    } else if ("value" in c) {
      params.push(c.value);
    } else {
      params.push(c);
    }
  }
}

function parseDrizzleQuery(query: unknown) {
  const sqlSegments: string[] = [];
  const params: unknown[] = [];
  extractSqlSegments(query, sqlSegments, params);
  return { sql: sqlSegments.join(""), params };
}

const pathQuery = sql`
        select
          d.id        as document_id,
          d.language  as language,
          string_agg(c.content, E'\n' order by c.chunk_index) as content,
          count(c.id) as chunk_count
        from documents d
        left join chunks c on c.document_id = d.id
        where d.path = ${"my-path/file.ts"}
          ${sql``}
        group by d.id, d.language
        limit 1
      `;
const tsq = sql`to_tsquery('english', ${"mySymbol"})`;
const refQuery = sql`
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
          ${sql``}
        order by ts_rank_cd(c.content_tsv, ${tsq}) desc
        limit ${20}
      `;

console.log("pathQuery:", parseDrizzleQuery(pathQuery));
console.log("refQuery:", parseDrizzleQuery(refQuery));
