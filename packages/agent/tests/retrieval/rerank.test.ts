/**
 * CohereReranker tests.
 * Inject a stub `fetch` so no HTTP touches the wire.
 */

import { describe, expect, it } from "vitest";
import { CohereReranker, RerankError } from "../../src/retrieval/rerank.js";
import type { SearchResult } from "../../src/retrieval/types.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFetch(handler: (req: Request) => Response | Promise<Response>): typeof fetch {
  return async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    return handler(req);
  };
}

function hit(id: string, score = 0.5): SearchResult {
  return {
    chunkId: id,
    documentId: `doc-${id}`,
    repoId: "repo-1",
    path: `src/${id}.ts`,
    content: `content-${id}`,
    contentWithContext: `context for ${id}: content-${id}`,
    startLine: 1,
    endLine: 10,
    symbolName: id,
    symbolKind: "function",
    score,
    bm25Rank: 1,
    vectorRank: 1,
    rrfScore: 0.5,
  };
}

describe("CohereReranker", () => {
  it("rejects construction without an api key", () => {
    expect(() => new CohereReranker({ apiKey: "" })).toThrow();
  });

  it("returns [] for empty hits without calling fetch", async () => {
    let called = false;
    const fetchImpl = makeFetch(async () => {
      called = true;
      return jsonResponse({ results: [] });
    });
    const reranker = new CohereReranker({ apiKey: "k", fetchImpl });
    expect(await reranker.rerank("q", [])).toEqual([]);
    expect(called).toBe(false);
  });

  it("falls back to a slice of original hits on empty query", async () => {
    const fetchImpl = makeFetch(async () => {
      throw new Error("Should not call Cohere on empty query");
    });
    const reranker = new CohereReranker({ apiKey: "k", fetchImpl });
    const result = await reranker.rerank("   ", [hit("a"), hit("b"), hit("c")], { topN: 2 });
    expect(result.map((r) => r.chunkId)).toEqual(["a", "b"]);
  });

  it("reorders by Cohere's relevance_score and attaches cohereRank", async () => {
    // Cohere reorders: c → a → b (by index 2 → 0 → 1)
    const fetchImpl = makeFetch(async () =>
      jsonResponse({
        results: [
          { index: 2, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.7 },
          { index: 1, relevance_score: 0.4 },
        ],
      }),
    );
    const reranker = new CohereReranker({ apiKey: "k", fetchImpl });
    const result = await reranker.rerank("q", [hit("a"), hit("b"), hit("c")]);

    expect(result.map((r) => r.chunkId)).toEqual(["c", "a", "b"]);
    expect(result.map((r) => r.cohereRank)).toEqual([1, 2, 3]);
    expect(result.map((r) => r.cohereScore)).toEqual([0.9, 0.7, 0.4]);
    // Original RRF breadcrumbs preserved
    expect(result[0]?.rrfScore).toBe(0.5);
    expect(result[0]?.bm25Rank).toBe(1);
  });

  it("sends content_with_context as documents (not raw content)", async () => {
    const seen: unknown[] = [];
    const fetchImpl = makeFetch(async (req) => {
      seen.push(await req.json());
      return jsonResponse({ results: [{ index: 0, relevance_score: 0.9 }] });
    });
    const reranker = new CohereReranker({ apiKey: "k", fetchImpl });
    await reranker.rerank("q", [hit("a")]);
    expect(seen[0]).toMatchObject({
      model: "rerank-v3.5",
      query: "q",
      documents: ["context for a: content-a"],
      top_n: 1,
    });
  });

  it("honors topN by trimming server requests", async () => {
    const seen: unknown[] = [];
    const fetchImpl = makeFetch(async (req) => {
      seen.push(await req.json());
      return jsonResponse({ results: [{ index: 0, relevance_score: 0.9 }] });
    });
    const reranker = new CohereReranker({ apiKey: "k", fetchImpl });
    await reranker.rerank("q", [hit("a"), hit("b"), hit("c")], { topN: 1 });
    expect(seen[0]).toMatchObject({ top_n: 1 });
  });

  it("retries on 503 then succeeds", async () => {
    let calls = 0;
    const fetchImpl = makeFetch(async () => {
      calls += 1;
      if (calls < 3) return new Response("busy", { status: 503 });
      return jsonResponse({ results: [{ index: 0, relevance_score: 0.9 }] });
    });
    const reranker = new CohereReranker({ apiKey: "k", fetchImpl });
    await reranker.rerank("q", [hit("a")]);
    expect(calls).toBe(3);
  });

  it("does not retry on 401", async () => {
    let calls = 0;
    const fetchImpl = makeFetch(async () => {
      calls += 1;
      return new Response("bad key", { status: 401 });
    });
    const reranker = new CohereReranker({ apiKey: "k", fetchImpl });
    await expect(reranker.rerank("q", [hit("a")])).rejects.toBeInstanceOf(RerankError);
    expect(calls).toBe(1);
  });

  it("rejects responses missing the results array", async () => {
    const fetchImpl = makeFetch(async () => jsonResponse({ unexpected: true }));
    const reranker = new CohereReranker({ apiKey: "k", fetchImpl });
    await expect(reranker.rerank("q", [hit("a")])).rejects.toBeInstanceOf(RerankError);
  });

  it("rejects results with out-of-range indices", async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse({ results: [{ index: 99, relevance_score: 0.9 }] }),
    );
    const reranker = new CohereReranker({ apiKey: "k", fetchImpl });
    await expect(reranker.rerank("q", [hit("a")])).rejects.toBeInstanceOf(RerankError);
  });

  it("rejects malformed result items", async () => {
    const fetchImpl = makeFetch(async () => jsonResponse({ results: [{ index: 0 }] }));
    const reranker = new CohereReranker({ apiKey: "k", fetchImpl });
    await expect(reranker.rerank("q", [hit("a")])).rejects.toBeInstanceOf(RerankError);
  });
});
