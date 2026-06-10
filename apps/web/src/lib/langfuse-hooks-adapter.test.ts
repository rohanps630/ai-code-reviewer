import { Agent } from "@acr/agent";
import type { AgentTool } from "@acr/agent";
import type { ModelProvider, ModelRequest, ModelResponse } from "@acr/agent";
import { describe, expect, it } from "vitest";
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

  it("wires cleanly through a complete (successful) run", async () => {
    const { span, generations } = fakeSpan();
    const agent = new Agent({
      model: scriptedProvider([
        {
          text: "answer",
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          stopReason: "stop",
        },
      ]),
      hooks: langfuseHooksAdapter(span),
    });
    await expect(agent.run("go")).resolves.toBe("answer");
    expect(generations).toHaveLength(1);
    expect(generations[0]?.ended).toHaveLength(1); // closed by afterModelCall
  });

  it("closes the dangling generation with ERROR when a model call throws", async () => {
    const { span, generations } = fakeSpan();
    const provider: ModelProvider = {
      provider: "fake",
      modelId: "fake-model",
      generate: async () => {
        throw new Error("upstream 503");
      },
    };
    const agent = new Agent({ model: provider, hooks: langfuseHooksAdapter(span) });

    await expect(agent.run("go")).rejects.toThrow(/upstream 503/);

    // beforeModelCall opened one generation; afterModelCall never ran, so
    // onRunError must have closed it (exactly once) with the error.
    expect(generations).toHaveLength(1);
    expect(generations[0]?.ended).toHaveLength(1);
    expect(generations[0]?.ended[0]?.level).toBe("ERROR");
    expect(generations[0]?.ended[0]?.statusMessage).toMatch(/upstream 503/);
  });

  it("does not double-close: a failure after a clean model call leaves no open generation", async () => {
    const { span, generations } = fakeSpan();
    // One clean model call (afterModelCall closes its generation), then the
    // stop tool is never called → AgentNoStopToolError. onRunError must NOT
    // re-close the already-closed generation.
    const agent = new Agent({
      model: scriptedProvider([
        {
          text: "I won't submit",
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          stopReason: "stop",
        },
      ]),
      stopTool: {
        name: "submit",
        description: "submit",
        inputSchema: { type: "object", properties: {} },
        validate: (r) => r,
      },
      hooks: langfuseHooksAdapter(span),
    });
    await expect(agent.run("go")).rejects.toThrow();
    expect(generations).toHaveLength(1);
    expect(generations[0]?.ended).toHaveLength(1); // closed once, by afterModelCall
  });
});
