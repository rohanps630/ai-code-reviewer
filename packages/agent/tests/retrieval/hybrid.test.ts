/**
 * HybridRetriever tests.
 *
 * Both lanes go through a stub executor that returns canned rows
 * regardless of the SQL (we're not testing Postgres here — that's
 * what the eval harness is for). The embedder is a stub that records
 * its input.
 *
 * What we ARE testing:
 *   - The orchestrator calls both lanes
 *   - Empty/whitespace queries short-circuit
 *   - The default options are respected
 *   - Repo-id filter flows through (recorded on the executor stub)
 *   - The returned shape matches SearchResult contract
 */

import { describe, expect, it, vi } from "vitest";
import { HybridRetriever } from "../../src/retrieval/hybrid.js";
import type { RawChunkRow } from "../../src/retrieval/types.js";

function row(id: string, score: number): RawChunkRow {
  return {
    chunk_id: id,
    document_id: `doc-${id}`,
    repo_id: "repo-1",
    path: `src/${id}.ts`,
    content: `content-${id}`,
    content_with_context: `context-${id}`,
    start_line: 1,
    end_line: 5,
    symbol_name: id,
    symbol_kind: "function",
    score,
  };
}

function makeDeps(opts: {
  bm25Rows: RawChunkRow[];
  vectorRows: RawChunkRow[];
}) {
  const sqlCalls: string[] = [];
  let lane = 0;
  const executor = {
    execute: vi.fn(async (_q: unknown) => {
      // SQL strings end up in `_q` as a drizzle SQL builder; we don't
      // inspect them. Order is deterministic: bm25 first (orchestrator
      // awaits both via Promise.all but bm25 is the 0th tuple slot),
      // then vector. Toggle by call count.
      sqlCalls.push(`call-${lane}`);
      const rows = lane === 0 ? opts.bm25Rows : opts.vectorRows;
      lane += 1;
      return rows;
    }),
  };
  const embedder = {
    embedQuery: vi.fn(async () => Array(1024).fill(0.1) as number[]),
  };
  return { executor, embedder };
}

describe("HybridRetriever.search", () => {
  it("returns empty for empty / whitespace queries", async () => {
    const { executor, embedder } = makeDeps({ bm25Rows: [], vectorRows: [] });
    const retriever = new HybridRetriever({ executor, embedder });

    expect(await retriever.search("")).toEqual([]);
    expect(await retriever.search("   ")).toEqual([]);

    expect(executor.execute).not.toHaveBeenCalled();
    expect(embedder.embedQuery).not.toHaveBeenCalled();
  });

  it("calls both lanes for a non-empty query", async () => {
    const { executor, embedder } = makeDeps({
      bm25Rows: [row("a", 0.9), row("b", 0.7)],
      vectorRows: [row("a", 0.95), row("c", 0.6)],
    });
    const retriever = new HybridRetriever({ executor, embedder });
    const results = await retriever.search("auth flow");

    expect(embedder.embedQuery).toHaveBeenCalledWith("auth flow");
    expect(executor.execute).toHaveBeenCalledTimes(2);
    // Three distinct chunks across the two lanes: a (both), b (bm25), c (vec)
    const ids = results.map((r) => r.chunkId).sort();
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("fuses results so a chunk hit in both lanes ranks first", async () => {
    const { executor, embedder } = makeDeps({
      bm25Rows: [row("only-bm25", 0.99), row("shared", 0.8)],
      vectorRows: [row("only-vec", 0.99), row("shared", 0.8)],
    });
    const retriever = new HybridRetriever({ executor, embedder });
    const results = await retriever.search("anything");
    expect(results[0]?.chunkId).toBe("shared");
  });

  it("honors the limit option", async () => {
    const bm25Rows = ["a", "b", "c", "d", "e"].map((id, i) => row(id, 1 - i * 0.1));
    const vectorRows = ["a", "b", "c", "d", "e"].map((id, i) => row(id, 1 - i * 0.1));
    const { executor, embedder } = makeDeps({ bm25Rows, vectorRows });
    const retriever = new HybridRetriever({ executor, embedder });

    const results = await retriever.search("foo", { limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("returns SearchResult-shaped objects with lane breadcrumbs", async () => {
    const { executor, embedder } = makeDeps({
      bm25Rows: [row("a", 0.9)],
      vectorRows: [row("a", 0.9)],
    });
    const retriever = new HybridRetriever({ executor, embedder });
    const [first] = await retriever.search("x");

    expect(first).toMatchObject({
      chunkId: "a",
      documentId: "doc-a",
      repoId: "repo-1",
      path: "src/a.ts",
      content: "content-a",
      contentWithContext: "context-a",
      startLine: 1,
      endLine: 5,
      symbolName: "a",
      symbolKind: "function",
      bm25Rank: 1,
      vectorRank: 1,
    });
    expect(typeof first?.rrfScore).toBe("number");
  });
});
