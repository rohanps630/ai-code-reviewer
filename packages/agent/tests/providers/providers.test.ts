/**
 * Provider-adapter tests.
 *
 * Each adapter is exercised end-to-end through an INJECTED fake client
 * shaped like the real SDK. We assert on request translation (neutral →
 * SDK) and response parsing (SDK → neutral). No network, no real SDKs,
 * no tokens.
 */

import { describe, expect, it, vi } from "vitest";

import { anthropic } from "../../src/providers/anthropic.js";
import { google } from "../../src/providers/google.js";
import { ProviderError, resolveModel } from "../../src/providers/index.js";
import type { ModelRequest } from "../../src/providers/index.js";
import { openai } from "../../src/providers/openai.js";

const baseRequest: ModelRequest = {
  system: "you are a reviewer",
  messages: [
    { role: "user", content: "review this" },
    {
      role: "assistant",
      content: "let me look",
      toolCalls: [{ id: "call-1", name: "search_code", input: { query: "auth" } }],
    },
    {
      role: "tool",
      toolCallId: "call-1",
      toolName: "search_code",
      content: '{"hits":[]}',
      isError: false,
    },
  ],
  tools: [
    {
      name: "search_code",
      description: "search",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
    },
  ],
  maxTokens: 1024,
};

// ────────────────────────────────────────────────────────────────────
// Anthropic
// ────────────────────────────────────────────────────────────────────

describe("anthropic adapter", () => {
  it("translates the request and parses a tool_use response", async () => {
    const create = vi.fn(async () => ({
      content: [
        { type: "text", text: "thinking" },
        { type: "tool_use", id: "tu_1", name: "search_code", input: { query: "x" } },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: "tool_use",
    }));
    const provider = anthropic("claude-sonnet-4-6", { client: { messages: { create } } });

    const res = await provider.generate(baseRequest);

    // Request shape
    const params = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.model).toBe("claude-sonnet-4-6");
    expect(params.system).toEqual([
      { type: "text", text: "you are a reviewer", cache_control: { type: "ephemeral" } },
    ]);
    expect(params.max_tokens).toBe(1024);
    expect((params.tools as unknown[])?.[0]).toMatchObject({
      name: "search_code",
      input_schema: expect.any(Object),
    });
    // Messages: user, assistant(text+tool_use), user(tool_result)
    const msgs = params.messages as Array<{ role: string; content: unknown }>;
    expect(msgs).toHaveLength(3);
    expect(msgs[2]?.role).toBe("user");
    expect((msgs[2]?.content as Array<{ type: string }>)[0]?.type).toBe("tool_result");

    // Response parsing
    expect(res.text).toBe("thinking");
    expect(res.toolCalls).toEqual([{ id: "tu_1", name: "search_code", input: { query: "x" } }]);
    expect(res.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(res.stopReason).toBe("tool_calls");
  });

  it("maps end_turn to stop", async () => {
    const create = vi.fn(async () => ({
      content: [{ type: "text", text: "final" }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "end_turn",
    }));
    const provider = anthropic("claude-haiku-4-5-20251001", { client: { messages: { create } } });
    const res = await provider.generate({ ...baseRequest, tools: [], messages: [] });
    expect(res.stopReason).toBe("stop");
    expect(res.toolCalls).toHaveLength(0);
    // No tools → omit the tools field entirely.
    expect((create.mock.calls[0]?.[0] as Record<string, unknown>).tools).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// OpenAI
// ────────────────────────────────────────────────────────────────────

describe("openai adapter", () => {
  it("translates messages and parses a tool-call response", async () => {
    const create = vi.fn(async () => ({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "tc_1",
                type: "function",
                function: { name: "search_code", arguments: '{"query":"y"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 7, completion_tokens: 3 },
    }));
    const provider = openai("gpt-4o", { client: { chat: { completions: { create } } } });

    const res = await provider.generate(baseRequest);

    const params = create.mock.calls[0]?.[0] as Record<string, unknown>;
    const msgs = params.messages as Array<{ role: string }>;
    // system, user, assistant(tool_calls), tool
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect((params.tools as unknown[])?.[0]).toMatchObject({ type: "function" });

    expect(res.text).toBe("");
    expect(res.toolCalls).toEqual([{ id: "tc_1", name: "search_code", input: { query: "y" } }]);
    expect(res.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    expect(res.stopReason).toBe("tool_calls");
  });

  it("throws ProviderError on empty choices", async () => {
    const create = vi.fn(async () => ({
      choices: [],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    }));
    const provider = openai("gpt-4o", { client: { chat: { completions: { create } } } });
    await expect(provider.generate(baseRequest)).rejects.toBeInstanceOf(ProviderError);
  });

  it("throws ProviderError on non-JSON tool arguments", async () => {
    const create = vi.fn(async () => ({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: "tc", type: "function", function: { name: "x", arguments: "not json" } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    }));
    const provider = openai("gpt-4o", { client: { chat: { completions: { create } } } });
    await expect(provider.generate(baseRequest)).rejects.toBeInstanceOf(ProviderError);
  });
});

// ────────────────────────────────────────────────────────────────────
// Google
// ────────────────────────────────────────────────────────────────────

describe("google adapter", () => {
  it("translates contents and parses function calls (synthesizing ids)", async () => {
    const generateContent = vi.fn(async () => ({
      text: "looking",
      functionCalls: [{ name: "search_code", args: { query: "z" } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 },
    }));
    const provider = google("gemini-2.5-pro", { client: { models: { generateContent } } });

    const res = await provider.generate(baseRequest);

    const params = generateContent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.model).toBe("gemini-2.5-pro");
    const config = params.config as Record<string, unknown>;
    expect(config.systemInstruction).toBe("you are a reviewer");
    // contents: user, model(text+functionCall), user(functionResponse)
    const contents = params.contents as Array<{ role: string; parts: unknown[] }>;
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(contents[2]?.parts[0]).toMatchObject({ functionResponse: { name: "search_code" } });

    expect(res.text).toBe("looking");
    expect(res.toolCalls).toEqual([
      { id: "search_code-0", name: "search_code", input: { query: "z" } },
    ]);
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 4 });
    expect(res.stopReason).toBe("tool_calls");
  });

  it("reports stop when no function calls are returned", async () => {
    const generateContent = vi.fn(async () => ({ text: "final answer" }));
    const provider = google("gemini-2.5-flash", { client: { models: { generateContent } } });
    const res = await provider.generate({ ...baseRequest, messages: [], tools: [] });
    expect(res.stopReason).toBe("stop");
    expect(res.text).toBe("final answer");
  });
});

// ────────────────────────────────────────────────────────────────────
// resolveModel
// ────────────────────────────────────────────────────────────────────

describe("resolveModel", () => {
  it("passes a provider object through untouched", () => {
    const provider = anthropic("claude-sonnet-4-6", { client: { messages: { create: vi.fn() } } });
    expect(resolveModel(provider)).toBe(provider);
  });

  it("routes model-id strings by prefix", () => {
    expect(resolveModel("claude-sonnet-4-6").provider).toBe("anthropic");
    expect(resolveModel("gpt-4o").provider).toBe("openai");
    expect(resolveModel("o3-mini").provider).toBe("openai");
    expect(resolveModel("gemini-2.5-pro").provider).toBe("google");
  });

  it("throws on an unrecognized model id", () => {
    expect(() => resolveModel("invalid-model")).toThrow(/Cannot infer a provider/);
  });
});
