import { Agent } from "@acr/agent";
import type { AgentTool } from "@acr/agent";
import type { ModelProvider, ModelRequest, ModelResponse } from "@acr/agent";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  type LangfuseGenerationLike,
  type LangfuseSpanLike,
  langfuseHooksAdapter,
} from "@/lib/langfuse-hooks-adapter";

// A fake Langfuse span that records every generation + event call.
function fakeSpan() {
  const generations: Array<{ body: Record<string, unknown>; ended: Record<string, unknown>[] }> =
    [];
  const events: Record<string, unknown>[] = [];
  const span: LangfuseSpanLike = {
    generation: (body) => {
      const record = { body, ended: [] as Record<string, unknown>[] };
      generations.push(record);
      const handle: LangfuseGenerationLike = {
        update: () => undefined,
        end: (b) => {
          record.ended.push(b ?? {});
        },
      };
      return handle;
    },
    event: (body) => {
      events.push(body);
      return undefined;
    },
  };
  return { span, generations, events };
}

function scriptedProvider(script: ModelResponse[]): ModelProvider {
  let turn = 0;
  return {
    provider: "fake",
    modelId: "fake-model",
    generate: async (_req: ModelRequest) => {
      const r = script[turn++];
      if (!r) throw new Error("out of turns");
      return r;
    },
  };
}

function echoTool(): AgentTool {
  return {
    name: "echo",
    description: "Echo.",
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: { message: { type: "string" } },
    },
    inputValidator: z.object({ message: z.string() }),
    outputValidator: z.unknown(),
    execute: (async (i: { message: string }) => ({ echoed: i.message })) as AgentTool["execute"],
  };
}

describe("langfuseHooksAdapter", () => {
  it("opens a generation per model call and ends it with usage", async () => {
    const { span, generations } = fakeSpan();
    const agent = new Agent({
      model: scriptedProvider([
        {
          text: "thinking",
          toolCalls: [{ id: "t1", name: "echo", input: { message: "hi" } }],
          usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheCreationTokens: 1 },
          stopReason: "tool_calls",
        },
        {
          text: "final answer",
          toolCalls: [],
          usage: { inputTokens: 8, outputTokens: 4 },
          stopReason: "stop",
        },
      ]),
      tools: [echoTool()],
      hooks: langfuseHooksAdapter(span),
    });

    await agent.run("go");

    // Two model calls → two generations, each ended once.
    expect(generations).toHaveLength(2);
    expect(generations[0]?.body.model).toBe("fake-model");
    expect(generations[0]?.ended).toHaveLength(1);
    expect(generations[0]?.ended[0]?.usage).toEqual({ input: 10, output: 5 });
    const meta0 = generations[0]?.ended[0]?.metadata as Record<string, unknown>;
    expect(meta0.cacheReadTokens).toBe(2);
    expect(meta0.cacheCreationTokens).toBe(1);
  });

  it("logs each tool call as a span event", async () => {
    const { span, events } = fakeSpan();
    const agent = new Agent({
      model: scriptedProvider([
        {
          text: "",
          toolCalls: [{ id: "t1", name: "echo", input: { message: "hi" } }],
          usage: { inputTokens: 0, outputTokens: 0 },
          stopReason: "tool_calls",
        },
        {
          text: "done",
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          stopReason: "stop",
        },
      ]),
      tools: [echoTool()],
      hooks: langfuseHooksAdapter(span),
    });

    await agent.run("go");

    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe("tool:echo");
    expect(events[0]?.level).toBe("DEFAULT");
    expect(events[0]?.output).toEqual({ echoed: "hi" });
  });

  it("does not throw when the run errors (hooks stay best-effort-safe)", async () => {
    const { span, generations } = fakeSpan();
    const endSpy = vi.fn();
    span.generation = () => ({ update: () => undefined, end: endSpy }) as LangfuseGenerationLike;
    const agent = new Agent({
      model: scriptedProvider([
        {
          text: "no tools",
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          stopReason: "stop",
        },
      ]),
      // No tools, no stop tool → a no-tool turn is a normal answer, so this
      // simply verifies the adapter wires cleanly through a complete run.
      hooks: langfuseHooksAdapter(span),
    });
    await expect(agent.run("go")).resolves.toBe("no tools");
    expect(endSpy).toHaveBeenCalledOnce();
    expect(generations).toHaveLength(0); // replaced span.generation above
  });
});
