import { describe, expect, it, vi } from "vitest";

import type { SearchResult } from "../../src/retrieval/index.js";
import { createSearchCodeTool } from "../../src/tools/index.js";

function hit(id: string, path = `src/${id}.ts`): SearchResult {
  return {
    chunkId: id,
    documentId: `doc-${id}`,
    repoId: "repo-1",
    path,
    content: `function ${id}() {}`,
    contentWithContext: `Context for ${id}.\nfunction ${id}() {}`,
    startLine: 10,
    endLine: 24,
    symbolName: id,
    symbolKind: "function",
    score: 0.8,
    bm25Rank: 1,
    vectorRank: 1,
    rrfScore: 0.5,
  };
}

describe("createSearchCodeTool", () => {
  it("exposes the canonical tool name + JSON schema", () => {
    const retriever = { search: vi.fn(async () => []) };
    const tool = createSearchCodeTool(retriever);
    expect(tool.name).toBe("search_code");
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.required).toContain("query");
  });

  it("calls the retriever with the query + default limit", async () => {
    const retriever = { search: vi.fn(async () => []) };
    const tool = createSearchCodeTool(retriever);
    await tool.execute({ query: "how does auth work" });
    expect(retriever.search).toHaveBeenCalledWith("how does auth work", {
      repoId: undefined,
      limit: 10,
    });
  });

  it("forwards repo_id (snake_case from the model) as repoId", async () => {
    const retriever = { search: vi.fn(async () => []) };
    const tool = createSearchCodeTool(retriever);
    await tool.execute({
      query: "x",
      repo_id: "00000000-0000-0000-0000-000000000001",
    });
    expect(retriever.search).toHaveBeenCalledWith("x", {
      repoId: "00000000-0000-0000-0000-000000000001",
      limit: 10,
    });
  });

  it("forwards an explicit limit", async () => {
    const retriever = { search: vi.fn(async () => []) };
    const tool = createSearchCodeTool(retriever);
    await tool.execute({ query: "x", limit: 5 });
    expect(retriever.search).toHaveBeenCalledWith("x", { repoId: undefined, limit: 5 });
  });

  it("maps SearchResult[] → minimal Hit[] (drops rrfScore / lane ranks)", async () => {
    const retriever = { search: vi.fn(async () => [hit("login", "src/auth/login.ts")]) };
    const tool = createSearchCodeTool(retriever);
    const out = await tool.execute({ query: "login" });
    expect(out).toEqual({
      hits: [
        {
          path: "src/auth/login.ts",
          start_line: 10,
          end_line: 24,
          symbol_name: "login",
          symbol_kind: "function",
          content_with_context: "Context for login.\nfunction login() {}",
        },
      ],
    });
  });

  it("input validator rejects empty queries", () => {
    const retriever = { search: vi.fn(async () => []) };
    const tool = createSearchCodeTool(retriever);
    const parsed = tool.inputValidator.safeParse({ query: "" });
    expect(parsed.success).toBe(false);
  });

  it("input validator rejects non-uuid repo_id", () => {
    const retriever = { search: vi.fn(async () => []) };
    const tool = createSearchCodeTool(retriever);
    const parsed = tool.inputValidator.safeParse({ query: "x", repo_id: "not-a-uuid" });
    expect(parsed.success).toBe(false);
  });

  it("input validator clamps limit at 20", () => {
    const retriever = { search: vi.fn(async () => []) };
    const tool = createSearchCodeTool(retriever);
    expect(tool.inputValidator.safeParse({ query: "x", limit: 21 }).success).toBe(false);
    expect(tool.inputValidator.safeParse({ query: "x", limit: 20 }).success).toBe(true);
  });
});
