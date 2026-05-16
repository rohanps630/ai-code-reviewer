/**
 * bm25.ts — smoke tests via a stub executor. We don't assert on the SQL
 * string (drizzle's `sql` template builds an opaque object); the unit
 * contract is empty query → no executor call, populated query → rows
 * map through rawRowToHit correctly.
 */

import { describe, expect, it, vi } from "vitest";
import { bm25Search } from "../../src/retrieval/bm25.js";
import type { RawChunkRow } from "../../src/retrieval/types.js";

describe("bm25Search", () => {
  it("short-circuits on empty / whitespace query", async () => {
    const executor = { execute: vi.fn() };
    expect(await bm25Search(executor, { query: "", limit: 10 })).toEqual([]);
    expect(await bm25Search(executor, { query: "   ", limit: 10 })).toEqual([]);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("returns mapped ChunkHits for a populated query", async () => {
    const row: RawChunkRow = {
      chunk_id: "c1",
      document_id: "d1",
      repo_id: "r1",
      path: "src/auth/login.ts",
      content: "export function login() {}",
      content_with_context: "Login flow: export function login() {}",
      start_line: 10,
      end_line: 24,
      symbol_name: "login",
      symbol_kind: "function",
      score: 0.42,
    };
    const executor = { execute: vi.fn(async () => [row]) };

    const hits = await bm25Search(executor, { query: "login", limit: 30 });

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      chunkId: "c1",
      path: "src/auth/login.ts",
      symbolName: "login",
      symbolKind: "function",
      score: 0.42,
    });
  });

  it("invokes the executor when a repoId is provided", async () => {
    const executor = { execute: vi.fn(async () => []) };
    await bm25Search(executor, {
      query: "anything",
      limit: 30,
      repoId: "00000000-0000-0000-0000-000000000001",
    });
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });
});
