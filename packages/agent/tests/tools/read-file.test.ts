import { describe, expect, it, vi } from "vitest";

import { createReadFileTool } from "../../src/tools/index.js";

describe("createReadFileTool", () => {
  it("names itself read_file and requires a path", () => {
    const tool = createReadFileTool({ execute: vi.fn() });
    expect(tool.name).toBe("read_file");
    expect(tool.inputSchema.required).toContain("path");
  });

  it("returns { found: true, ... } when the document exists", async () => {
    const executor = {
      execute: vi.fn(async () => [
        {
          document_id: "d1",
          language: "typescript",
          content: "// chunk 1\n// chunk 2",
          chunk_count: 2,
        },
      ]),
    };
    const tool = createReadFileTool(executor);
    const out = await tool.execute({ path: "src/auth/login.ts" });
    expect(out).toEqual({
      found: true,
      path: "src/auth/login.ts",
      language: "typescript",
      content: "// chunk 1\n// chunk 2",
      chunk_count: 2,
    });
  });

  it("returns { found: false, path } when the document is missing", async () => {
    const tool = createReadFileTool({ execute: vi.fn(async () => []) });
    const out = await tool.execute({ path: "nope.ts" });
    expect(out).toEqual({ found: false, path: "nope.ts" });
  });

  it("coerces a string chunk_count (postgres-js numeric) to number", async () => {
    const executor = {
      execute: vi.fn(async () => [
        {
          document_id: "d1",
          language: null,
          content: "x",
          chunk_count: "7",
        },
      ]),
    };
    const tool = createReadFileTool(executor);
    const out = await tool.execute({ path: "src/x.ts" });
    if (out.found) {
      expect(out.chunk_count).toBe(7);
    }
  });

  it("calls the executor (we don't inspect SQL — that's a higher-level concern)", async () => {
    const executor = { execute: vi.fn(async () => []) };
    const tool = createReadFileTool(executor);
    await tool.execute({ path: "src/x.ts", repo_id: "00000000-0000-0000-0000-000000000001" });
    expect(executor.execute).toHaveBeenCalledOnce();
  });

  it("input validator rejects empty path", () => {
    const tool = createReadFileTool({ execute: vi.fn() });
    expect(tool.inputValidator.safeParse({ path: "" }).success).toBe(false);
  });

  it("input validator rejects non-uuid repo_id", () => {
    const tool = createReadFileTool({ execute: vi.fn() });
    expect(tool.inputValidator.safeParse({ path: "src/x.ts", repo_id: "abc" }).success).toBe(false);
  });
});
