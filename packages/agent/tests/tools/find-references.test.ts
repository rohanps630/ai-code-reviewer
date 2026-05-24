import { describe, expect, it, vi } from "vitest";

import { createFindReferencesTool } from "../../src/tools/index.js";

describe("createFindReferencesTool", () => {
  it("names itself find_references", () => {
    const tool = createFindReferencesTool({ execute: vi.fn() });
    expect(tool.name).toBe("find_references");
  });

  it("returns mapped References from row data", async () => {
    const executor = {
      execute: vi.fn(async () => [
        {
          path: "src/auth/login.ts",
          start_line: 10,
          end_line: 24,
          symbol_name: "loginHandler",
          symbol_kind: "function",
          content: "function loginHandler() { createSession() }",
        },
      ]),
    };
    const tool = createFindReferencesTool(executor);
    const out = await tool.execute({ symbol: "createSession" });
    expect(out.symbol).toBe("createSession");
    expect(out.references).toEqual([
      {
        path: "src/auth/login.ts",
        start_line: 10,
        end_line: 24,
        symbol_name: "loginHandler",
        symbol_kind: "function",
        snippet: "function loginHandler() { createSession() }",
      },
    ]);
  });

  it("trims long snippets to the first ~12 lines + ellipsis", async () => {
    const longContent = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    const executor = {
      execute: vi.fn(async () => [
        {
          path: "src/big.ts",
          start_line: 1,
          end_line: 30,
          symbol_name: null,
          symbol_kind: null,
          content: longContent,
        },
      ]),
    };
    const tool = createFindReferencesTool(executor);
    const out = await tool.execute({ symbol: "foo" });
    const snippet = out.references[0]?.snippet ?? "";
    expect(snippet.split("\n").length).toBe(13); // 12 lines + ellipsis
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("input validator rejects symbols < 3 chars", () => {
    const tool = createFindReferencesTool({ execute: vi.fn() });
    expect(tool.inputValidator.safeParse({ symbol: "ab" }).success).toBe(false);
  });

  it("input validator rejects non-identifier-shaped symbols", () => {
    const tool = createFindReferencesTool({ execute: vi.fn() });
    expect(tool.inputValidator.safeParse({ symbol: "has space" }).success).toBe(false);
    expect(tool.inputValidator.safeParse({ symbol: "123start" }).success).toBe(false);
  });

  it("input validator caps limit at 50", () => {
    const tool = createFindReferencesTool({ execute: vi.fn() });
    expect(tool.inputValidator.safeParse({ symbol: "abc", limit: 51 }).success).toBe(false);
    expect(tool.inputValidator.safeParse({ symbol: "abc", limit: 50 }).success).toBe(true);
  });

  it("returns an empty references array when no rows match", async () => {
    const tool = createFindReferencesTool({ execute: vi.fn(async () => []) });
    const out = await tool.execute({ symbol: "missingSymbol" });
    expect(out.references).toEqual([]);
  });
});
