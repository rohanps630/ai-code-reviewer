/**
 * Agent loop tests.
 *
 * The loop is driven by a SCRIPTED fake provider — no SDKs, no network,
 * no tokens. We assert on loop CONTROL FLOW (tool round-trips, conversation
 * state, termination, error feedback), never on LLM output content
 * (AGENTS.md § 7 — that's what evals are for).
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { Agent, AgentMaxIterationsError } from "../src/agent.js";
import type { AgentTool } from "../src/agent.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "../src/providers/index.js";

// ────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────

/** A provider that returns a pre-scripted response per turn and records
 *  every request it received. */
function scriptedProvider(script: ModelResponse[]): {
  model: ModelProvider;
  calls: ModelRequest[];
} {
  const calls: ModelRequest[] = [];
  let turn = 0;
  const model: ModelProvider = {
    provider: "fake",
    modelId: "fake-1",
    generate: vi.fn(async (request: ModelRequest) => {
      // Snapshot: the Agent reuses one messages array across turns, so we
      // copy to capture this turn's history. (Elements are never mutated
      // in place — only appended — so a shallow copy is faithful.)
      calls.push({ ...request, messages: [...request.messages] });
      const response = script[turn];
      if (!response) throw new Error(`scriptedProvider ran out of turns at ${turn}`);
      turn++;
      return response;
    }),
  };
  return { model, calls };
}

const final = (text: string): ModelResponse => ({
  text,
  toolCalls: [],
  usage: { inputTokens: 0, outputTokens: 0 },
  stopReason: "stop",
});

const withToolCall = (id: string, name: string, input: unknown): ModelResponse => ({
  text: "",
  toolCalls: [{ id, name, input }],
  usage: { inputTokens: 0, outputTokens: 0 },
  stopReason: "tool_calls",
});

/** In-memory echo tool; optional execute override to force a throw. */
function echoTool(
  execute?: (input: { message: string }) => Promise<{ echoed: string }>,
): AgentTool {
  return {
    name: "echo",
    description: "Echo a message back.",
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: { message: { type: "string" } },
    },
    inputValidator: z.object({ message: z.string().min(1) }),
    outputValidator: z.object({ echoed: z.string() }),
    execute: (execute ?? (async (i) => ({ echoed: i.message }))) as AgentTool["execute"],
  };
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe("Agent.run", () => {
  it("returns the model's text immediately when no tools are called", async () => {
    const { model, calls } = scriptedProvider([final("done")]);
    const agent = new Agent({ model, systemPrompt: "sys" });

    const out = await agent.run("hello");

    expect(out).toBe("done");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.system).toBe("sys");
    expect(calls[0]?.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("executes a requested tool and feeds the result back before finishing", async () => {
    const { model, calls } = scriptedProvider([
      withToolCall("call-1", "echo", { message: "hi" }),
      final("answer"),
    ]);
    const agent = new Agent({ model, tools: [echoTool()] });

    const out = await agent.run("go");

    expect(out).toBe("answer");
    expect(calls).toHaveLength(2);
    // Second turn's history: user, assistant(tool_call), tool(result).
    const second = calls[1]?.messages ?? [];
    expect(second).toHaveLength(3);
    expect(second[1]).toMatchObject({ role: "assistant", toolCalls: [{ name: "echo" }] });
    expect(second[2]).toMatchObject({
      role: "tool",
      toolCallId: "call-1",
      toolName: "echo",
      isError: false,
    });
    expect(JSON.parse((second[2] as { content: string }).content)).toEqual({ echoed: "hi" });
  });

  it("advertises tool specs to the provider", async () => {
    const { model, calls } = scriptedProvider([final("ok")]);
    const agent = new Agent({ model, tools: [echoTool()] });

    await agent.run("go");

    expect(calls[0]?.tools).toEqual([
      { name: "echo", description: "Echo a message back.", inputSchema: expect.any(Object) },
    ]);
  });

  it("feeds a failed tool back as an error result instead of throwing", async () => {
    const boom = echoTool(async () => {
      throw new Error("kaboom");
    });
    const { model, calls } = scriptedProvider([
      withToolCall("call-1", "echo", { message: "hi" }),
      final("recovered"),
    ]);
    const agent = new Agent({ model, tools: [boom] });

    const out = await agent.run("go");

    expect(out).toBe("recovered");
    const toolMsg = (calls[1]?.messages ?? [])[2] as { isError: boolean; content: string };
    expect(toolMsg.isError).toBe(true);
    expect(toolMsg.content).toMatch(/kaboom/);
  });

  it("surfaces an unknown tool as an error result (model can self-correct)", async () => {
    const { model, calls } = scriptedProvider([
      withToolCall("call-1", "nonexistent", {}),
      final("ok"),
    ]);
    const agent = new Agent({ model, tools: [echoTool()] });

    await agent.run("go");

    const toolMsg = (calls[1]?.messages ?? [])[2] as { isError: boolean; content: string };
    expect(toolMsg.isError).toBe(true);
    expect(toolMsg.content).toMatch(/Unknown tool/);
  });

  it("throws AgentMaxIterationsError when the model never stops calling tools", async () => {
    // Always asks for a tool, never a final answer.
    const loopResponse = withToolCall("c", "echo", { message: "x" });
    const { model } = scriptedProvider(Array(5).fill(loopResponse));
    const agent = new Agent({ model, tools: [echoTool()], maxIterations: 3 });

    await expect(agent.run("go")).rejects.toBeInstanceOf(AgentMaxIterationsError);
  });

  it("validates tool names at construction time", () => {
    const bad = { ...echoTool(), name: "Echo-Bad" } as AgentTool;
    expect(() => new Agent({ model: scriptedProvider([]).model, tools: [bad] })).toThrow(
      /Invalid tool name/,
    );
  });

  it("exposes the resolved model id", () => {
    const { model } = scriptedProvider([]);
    expect(new Agent({ model }).modelId).toBe("fake-1");
  });
});
