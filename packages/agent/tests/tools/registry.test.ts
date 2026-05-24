/**
 * Tool framework tests — registry construction + dispatch.
 * Pure-code tests; no API calls; no shared state between tests.
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  type Tool,
  ToolOutputValidationError,
  buildToolRegistry,
  executeToolCall,
  toAnthropicTools,
} from "../../src/tools/index.js";

// ────────────────────────────────────────────────────────────────────
// Fixture tool — echoes its input as output
// ────────────────────────────────────────────────────────────────────

const EchoInputSchema = z.object({ message: z.string().min(1) });
const EchoOutputSchema = z.object({ echoed: z.string() });

function echoTool(execute?: (input: { message: string }) => Promise<{ echoed: string }>): Tool {
  return {
    name: "echo",
    description: "Echo a message back. Test tool.",
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: { message: { type: "string" } },
    },
    inputValidator: EchoInputSchema,
    outputValidator: EchoOutputSchema,
    execute: (execute ?? (async (i) => ({ echoed: i.message }))) as Tool["execute"],
  };
}

// ────────────────────────────────────────────────────────────────────
// buildToolRegistry
// ────────────────────────────────────────────────────────────────────

describe("buildToolRegistry", () => {
  it("indexes tools by name", () => {
    const r = buildToolRegistry([echoTool()]);
    expect(r.get("echo")?.name).toBe("echo");
    expect(r.size).toBe(1);
  });

  it("rejects duplicate names", () => {
    expect(() => buildToolRegistry([echoTool(), echoTool()])).toThrow(/Duplicate/);
  });

  it("rejects names that aren't snake_case lowercase", () => {
    const t = { ...echoTool(), name: "ECHO" } as Tool;
    expect(() => buildToolRegistry([t])).toThrow(/Invalid tool name/);
  });

  it("rejects names with hyphens", () => {
    const t = { ...echoTool(), name: "search-code" } as Tool;
    expect(() => buildToolRegistry([t])).toThrow(/Invalid tool name/);
  });
});

// ────────────────────────────────────────────────────────────────────
// toAnthropicTools
// ────────────────────────────────────────────────────────────────────

describe("toAnthropicTools", () => {
  it("strips zod validators and exposes name/description/input_schema", () => {
    const out = toAnthropicTools(buildToolRegistry([echoTool()]));
    expect(out).toEqual([
      {
        name: "echo",
        description: "Echo a message back. Test tool.",
        input_schema: {
          type: "object",
          required: ["message"],
          properties: { message: { type: "string" } },
        },
      },
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────
// executeToolCall
// ────────────────────────────────────────────────────────────────────

describe("executeToolCall", () => {
  it("returns ok:true with the tool's output on success", async () => {
    const r = buildToolRegistry([echoTool()]);
    const result = await executeToolCall(r, {
      id: "call_1",
      name: "echo",
      input: { message: "hello" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toEqual({ echoed: "hello" });
  });

  it("returns ok:false with a model-readable error on unknown tool", async () => {
    const r = buildToolRegistry([echoTool()]);
    const result = await executeToolCall(r, {
      id: "call_2",
      name: "missing",
      input: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Unknown tool: missing/);
      expect(result.name).toBe("missing");
      expect(result.id).toBe("call_2");
    }
  });

  it("returns ok:false when input validation fails (with issue path)", async () => {
    const r = buildToolRegistry([echoTool()]);
    const result = await executeToolCall(r, {
      id: "call_3",
      name: "echo",
      input: { message: 42 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/input validation failed/);
      expect(result.error).toMatch(/message/);
    }
  });

  it("returns ok:false with the tool's error message when execute throws", async () => {
    const r = buildToolRegistry([
      echoTool(async () => {
        throw new Error("file not found: foo.ts");
      }),
    ]);
    const result = await executeToolCall(r, {
      id: "call_4",
      name: "echo",
      input: { message: "x" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("file not found: foo.ts");
  });

  it("throws ToolOutputValidationError when execute returns the wrong shape", async () => {
    // The tool returns nonsense; outputValidator rejects it; we throw
    // because that's an OUR-bug situation, not a model-recoverable one.
    const broken = echoTool(async () => ({ echoed: 123 }) as unknown as { echoed: string });
    const r = buildToolRegistry([broken]);
    await expect(
      executeToolCall(r, { id: "x", name: "echo", input: { message: "ok" } }),
    ).rejects.toBeInstanceOf(ToolOutputValidationError);
  });

  it("passes parsed (not raw) input into execute", async () => {
    const exec = vi.fn(async (input: { message: string }) => ({ echoed: input.message }));
    const r = buildToolRegistry([echoTool(exec)]);
    await executeToolCall(r, {
      id: "call_5",
      name: "echo",
      // Extra field gets stripped by zod's default object parsing.
      input: { message: "hi", extra: "ignored" },
    });
    expect(exec).toHaveBeenCalledTimes(1);
    const call = exec.mock.calls[0]?.[0];
    expect(call).toEqual({ message: "hi" });
  });
});
