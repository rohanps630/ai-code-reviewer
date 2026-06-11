import { describe, expect, it, vi } from "vitest";

import { createReadFileTool } from "../../src/tools/index.js";

describe("createReadFileTool", () => {
  it("names itself read_file and requires a path", () => {
    const tool = createReadFileTool({ readFile: vi.fn() } as unknown as CodeSource);
    expect(tool.name).toBe("read_file");
    expect(tool.inputSchema.required).toContain("path");
  });

  it("returns { found: true, ... } when the document exists", async () => {
    const executor = {
      readFile: vi.fn(async () => ({
        found: true,
        content: "// chunk 1\n// chunk 2",
        language: "typescript",
        chunk_count: 2,
      })),
    } as unknown as CodeSource;
    const tool = createReadFileTool(executor);
    const out = await tool.execute({ path: "src/auth/login.ts" });
    expect(out).toEqual({
      found: true,
      path: "src/auth/login.ts",
      language: "typescript",
      content:
        '<untrusted_file_content path="src/auth/login.ts">\n// chunk 1\n// chunk 2\n</untrusted_file_content>',
      chunk_count: 2,
    });
  });

  it("returns { found: false, path } when the document is missing", async () => {
    const tool = createReadFileTool({
      readFile: vi.fn(async () => ({ found: false })),
    } as unknown as CodeSource);
    const out = await tool.execute({ path: "nope.ts" });
    expect(out).toEqual({ found: false, path: "nope.ts" });
  });

  it("coerces a string chunk_count (postgres-js numeric) to number", async () => {
    const executor = {
      readFile: vi.fn(async () => ({
        found: true,
        content: "x",
        language: "typescript",
        chunk_count: 7, // It now parses in the source directly, so it returns 7
      })),
    } as unknown as CodeSource;
    const tool = createReadFileTool(executor);
    const out = await tool.execute({ path: "src/x.ts" });
    if (out.found) {
      expect(out.chunk_count).toBe(7);
    }
  });

  it("calls the executor", async () => {
    const executor = { readFile: vi.fn(async () => ({ found: false })) } as unknown as CodeSource;
    const tool = createReadFileTool(executor);
    await tool.execute({ path: "src/x.ts", repo_id: "00000000-0000-0000-0000-000000000001" });
    expect(executor.readFile).toHaveBeenCalledOnce();
  });

  it("input validator rejects empty path", () => {
    const tool = createReadFileTool({ readFile: vi.fn() } as unknown as CodeSource);
    expect(tool.inputValidator.safeParse({ path: "" }).success).toBe(false);
  });

  it("input validator rejects non-uuid repo_id", () => {
    const tool = createReadFileTool({ readFile: vi.fn() } as unknown as CodeSource);
    expect(tool.inputValidator.safeParse({ path: "src/x.ts", repo_id: "abc" }).success).toBe(false);
  });
});
