/**
 * Agent runtime tests (ADR-004) — Critical + Important tiers.
 *
 * Everything is driven by SCRIPTED providers and in-memory tools: no SDKs,
 * no network, no tokens, no real sleeps (timeouts use fake timers). Per
 * guidelines § 7 we assert on CONTROL FLOW (event order, accounting,
 * termination, cancellation, hooks), never on LLM output content.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  AgentAbortedError,
  AgentCostCapError,
  AgentError,
  AgentMaxIterationsError,
  AgentNoStopToolError,
  AgentStopToolValidationError,
} from "../src/agent-types.js";
import type { AgentEvent, StopToolConfig } from "../src/agent-types.js";
import { Agent } from "../src/agent.js";
import type { AgentTool } from "../src/agent.js";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  TokenUsage,
} from "../src/providers/index.js";

// ────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────

type Scripted = {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  usage?: TokenUsage;
};

function scriptedProvider(script: Scripted[]): ModelProvider {
  let turn = 0;
  return {
    provider: "fake",
    modelId: "fake-1",
    generate: async (_req: ModelRequest): Promise<ModelResponse> => {
      const r = script[turn++];
      if (!r) throw new Error(`scriptedProvider ran out of turns at ${turn}`);
      return {
        text: r.text ?? "",
        toolCalls: r.toolCalls ?? [],
        usage: r.usage ?? { inputTokens: 0, outputTokens: 0 },
        stopReason: r.toolCalls && r.toolCalls.length > 0 ? "tool_calls" : "stop",
      };
    },
  };
}

/** A provider whose single call rejects only when its signal aborts. */
function hangingProvider(onCall?: () => void): ModelProvider {
  return {
    provider: "fake",
    modelId: "fake-1",
    generate: (req: ModelRequest): Promise<ModelResponse> =>
      new Promise((_resolve, reject) => {
        req.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        onCall?.();
      }),
  };
}

function echoTool(execute?: (input: { message: string }) => Promise<unknown>): AgentTool {
  return {
    name: "echo",
    description: "Echo a message.",
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: { message: { type: "string" } },
    },
    inputValidator: z.object({ message: z.string() }),
    outputValidator: z.unknown(),
    execute: (execute ??
      (async (i: { message: string }) => ({ echoed: i.message }))) as AgentTool["execute"],
  };
}

const STOP_TOOL: StopToolConfig = {
  name: "submit",
  description: "Submit the final answer.",
  inputSchema: { type: "object", required: ["answer"], properties: { answer: { type: "string" } } },
  validate: (raw) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof (raw as { answer?: unknown }).answer !== "string"
    ) {
      throw new Error("answer must be a string");
    }
    return raw;
  },
};

const submitCall = (answer: unknown) => ({ id: "tu_submit", name: "submit", input: { answer } });
const echoCall = (message: string, id = "tu_echo") => ({ id, name: "echo", input: { message } });

async function collect(stream: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ────────────────────────────────────────────────────────────────────
// 2.1 — event ordering
// ────────────────────────────────────────────────────────────────────

describe("stream() event ordering", () => {
  it("emits run_start → model_call_start → model_response → tool_call → tool_result → … → final", async () => {
    const agent = new Agent({
      model: scriptedProvider([
        { text: "looking", toolCalls: [echoCall("hi")] },
        { text: "done", toolCalls: [submitCall("ok")] },
      ]),
      tools: [echoTool()],
      stopTool: STOP_TOOL,
    });

    const events = await collect(agent.stream("go"));
    expect(events.map((e) => e.type)).toEqual([
      "run_start",
      "model_call_start",
      "model_response",
      "tool_call",
      "tool_result",
      "model_call_start",
      "model_response",
      "final",
    ]);

    const final = events.at(-1);
    expect(final?.type).toBe("final");
    if (final?.type === "final") {
      expect(final.stopReason).toBe("stop_tool");
      expect(final.stopToolInput).toEqual({ answer: "ok" });
      expect(final.iterations).toBe(2);
      expect(final.messages.length).toBeGreaterThan(0);
    }
  });

  it("every event carries the same runId and a timestamp", async () => {
    const agent = new Agent({
      model: scriptedProvider([{ text: "hi", toolCalls: [submitCall("x")] }]),
      stopTool: STOP_TOOL,
    });
    const events = await collect(agent.stream("go"));
    const ids = new Set(events.map((e) => e.runId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(events.every((e) => typeof e.timestamp === "number")).toBe(true);
  });

  it("without a stop tool, a no-tool turn ends with stopReason 'answer'", async () => {
    const agent = new Agent({ model: scriptedProvider([{ text: "the answer" }]) });
    const events = await collect(agent.stream("go"));
    const final = events.at(-1);
    expect(final?.type).toBe("final");
    if (final?.type === "final") {
      expect(final.stopReason).toBe("answer");
      expect(final.text).toBe("the answer");
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// 2.2 — usage + cost accounting + spend cap
// ────────────────────────────────────────────────────────────────────

describe("usage + cost accounting", () => {
  it("accumulates token usage across iterations into the final event", async () => {
    const agent = new Agent({
      model: scriptedProvider([
        { toolCalls: [echoCall("a")], usage: { inputTokens: 100, outputTokens: 20 } },
        { toolCalls: [submitCall("ok")], usage: { inputTokens: 50, outputTokens: 10 } },
      ]),
      tools: [echoTool()],
      stopTool: STOP_TOOL,
      pricing: { input: 3, output: 15 },
    });
    const events = await collect(agent.stream("go"));
    const final = events.at(-1);
    if (final?.type === "final") {
      expect(final.usage.inputTokens).toBe(150);
      expect(final.usage.outputTokens).toBe(30);
      // (150/1e6)*3 + (30/1e6)*15 = 0.00045 + 0.00045
      expect(final.usage.costUsd).toBeCloseTo(0.0009, 9);
    }
  });

  it("prices cache tokens with the read/write multipliers", async () => {
    // Anthropic returns inputTokens as the NON-cached portion only.
    // cache tokens are separate fields, not included in inputTokens.
    // Scenario: 500k non-cached, 400k cache-read, 100k cache-write.
    const agent = new Agent({
      model: scriptedProvider([
        {
          toolCalls: [submitCall("ok")],
          usage: {
            inputTokens: 500_000,
            outputTokens: 0,
            cacheReadTokens: 400_000,
            cacheCreationTokens: 100_000,
          },
        },
      ]),
      stopTool: STOP_TOOL,
      pricing: { input: 10, output: 20 },
    });
    const events = await collect(agent.stream("go"));
    const final = events.at(-1);
    if (final?.type === "final") {
      // base 500k×10 → 5.0 ; read 400k×(10×0.1)=1 → 0.4 ; write 100k×(10×1.25)=12.5 → 1.25
      expect(final.usage.costUsd).toBeCloseTo(5.0 + 0.4 + 1.25, 6);
      expect(final.usage.cacheReadTokens).toBe(400_000);
      expect(final.usage.cacheCreationTokens).toBe(100_000);
    }
  });

  it("throws AgentCostCapError after tool execution when the cap trips", async () => {
    const agent = new Agent({
      model: scriptedProvider([
        { toolCalls: [echoCall("x")], usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } },
      ]),
      tools: [echoTool()],
      stopTool: STOP_TOOL,
      pricing: { input: 3, output: 15 },
      costCapUsd: 1.0,
    });
    await expect(collect(agent.stream("go"))).rejects.toBeInstanceOf(AgentCostCapError);
  });

  it("disables the cap when pricing is absent (cost stays 0)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const agent = new Agent({
      model: scriptedProvider([
        { toolCalls: [echoCall("x")], usage: { inputTokens: 9_000_000, outputTokens: 9_000_000 } },
        { toolCalls: [submitCall("ok")] },
      ]),
      tools: [echoTool()],
      stopTool: STOP_TOOL,
      costCapUsd: 0.0001,
    });
    const events = await collect(agent.stream("go"));
    const final = events.at(-1);
    expect(final?.type).toBe("final");
    if (final?.type === "final") expect(final.usage.costUsd).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
  });
});

// ────────────────────────────────────────────────────────────────────
// 2.3 — cancellation
// ────────────────────────────────────────────────────────────────────

describe("cancellation", () => {
  it("throws AgentAbortedError when the signal is already aborted (loop boundary)", async () => {
    const agent = new Agent({
      model: scriptedProvider([{ toolCalls: [submitCall("ok")] }]),
      stopTool: STOP_TOOL,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(collect(agent.stream("go", { signal: controller.signal }))).rejects.toBeInstanceOf(
      AgentAbortedError,
    );
  });

  it("throws AgentAbortedError when aborted mid model call", async () => {
    const controller = new AbortController();
    const agent = new Agent({ model: hangingProvider(() => controller.abort()) });
    await expect(collect(agent.stream("go", { signal: controller.signal }))).rejects.toBeInstanceOf(
      AgentAbortedError,
    );
  });

  it("emits run_error just before throwing", async () => {
    const controller = new AbortController();
    controller.abort();
    const agent = new Agent({ model: scriptedProvider([{ text: "x" }]) });
    const events: AgentEvent[] = [];
    await expect(
      (async () => {
        for await (const ev of agent.stream("go", { signal: controller.signal })) events.push(ev);
      })(),
    ).rejects.toBeInstanceOf(AgentAbortedError);
    expect(events.at(-1)?.type).toBe("run_error");
  });
});

// ────────────────────────────────────────────────────────────────────
// 2.4 — timeouts (fake timers, no real sleeps)
// ────────────────────────────────────────────────────────────────────

describe("timeouts", () => {
  it("model timeout throws AgentTimeoutError(budget=model)", async () => {
    vi.useFakeTimers();
    const agent = new Agent({ model: hangingProvider(), timeouts: { modelCallMs: 1000 } });
    const drain = collect(agent.stream("go"));
    const assertion = expect(drain).rejects.toMatchObject({
      name: "AgentTimeoutError",
      budget: "model",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("run timeout throws AgentTimeoutError(budget=run)", async () => {
    vi.useFakeTimers();
    const agent = new Agent({
      model: hangingProvider(),
      timeouts: { modelCallMs: 100_000, runMs: 500 },
    });
    const drain = collect(agent.stream("go"));
    const assertion = expect(drain).rejects.toMatchObject({
      name: "AgentTimeoutError",
      budget: "run",
    });
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it("tool timeout throws AgentTimeoutError(budget=tool)", async () => {
    vi.useFakeTimers();
    const agent = new Agent({
      model: scriptedProvider([{ toolCalls: [echoCall("x")] }]),
      tools: [echoTool(() => new Promise(() => undefined))], // never resolves
      timeouts: { toolCallMs: 800 },
    });
    const drain = collect(agent.stream("go"));
    const assertion = expect(drain).rejects.toMatchObject({
      name: "AgentTimeoutError",
      budget: "tool",
    });
    await vi.advanceTimersByTimeAsync(800);
    await assertion;
  });
});

// ────────────────────────────────────────────────────────────────────
// 2.5 — error taxonomy
// ────────────────────────────────────────────────────────────────────

describe("error taxonomy", () => {
  it("AgentError carries runId and partial usage", async () => {
    const agent = new Agent({
      model: scriptedProvider([
        { toolCalls: [echoCall("x")], usage: { inputTokens: 1_000_000, outputTokens: 0 } },
      ]),
      tools: [echoTool()],
      stopTool: STOP_TOOL,
      pricing: { input: 3, output: 15 },
      costCapUsd: 0.5,
    });
    try {
      await collect(agent.stream("go"));
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      const ae = err as AgentError;
      expect(ae.runId).toMatch(/^[0-9a-f-]{36}$/);
      expect(ae.usage.inputTokens).toBe(1_000_000);
      expect((err as AgentCostCapError).iteration).toBe(1);
    }
  });

  it("throws AgentMaxIterationsError when the stop tool is never called", async () => {
    const agent = new Agent({
      model: scriptedProvider([{ toolCalls: [echoCall("x")] }, { toolCalls: [echoCall("x")] }]),
      tools: [echoTool()],
      stopTool: STOP_TOOL,
      maxIterations: 2,
    });
    await expect(collect(agent.stream("go"))).rejects.toBeInstanceOf(AgentMaxIterationsError);
  });
});

// ────────────────────────────────────────────────────────────────────
// 2.6 — tool output discipline
// ────────────────────────────────────────────────────────────────────

describe("tool output discipline", () => {
  it("truncates long tool output fed to the model but keeps the full event output", async () => {
    const big = "x".repeat(5000);
    const captured: ModelRequest[] = [];
    const provider: ModelProvider = {
      provider: "fake",
      modelId: "fake-1",
      generate: async (req): Promise<ModelResponse> => {
        captured.push({ ...req, messages: [...req.messages] });
        const turn = captured.length;
        return {
          text: "",
          toolCalls: turn === 1 ? [echoCall(big)] : [submitCall("ok")],
          usage: { inputTokens: 0, outputTokens: 0 },
          stopReason: "tool_calls",
        };
      },
    };
    const agent = new Agent({
      model: provider,
      tools: [echoTool(async (i) => ({ echoed: i.message }))],
      stopTool: STOP_TOOL,
      maxToolResultChars: 100,
    });

    const events = await collect(agent.stream("go"));
    const toolResult = events.find((e) => e.type === "tool_result");
    // Event carries the full output…
    if (toolResult?.type === "tool_result") {
      expect(JSON.stringify(toolResult.output).length).toBeGreaterThan(1000);
    }
    // …but the conversation message is truncated with the marker.
    const toolMsg = captured[1]?.messages.find((m) => m.role === "tool");
    expect(toolMsg && "content" in toolMsg ? toolMsg.content : "").toMatch(
      /…\[truncated: 100 of \d+ chars/,
    );
  });

  it("runs a tool batch with at most maxConcurrentTools in flight", async () => {
    let active = 0;
    let maxActive = 0;
    const tool = echoTool(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { ok: true };
    });
    const agent = new Agent({
      model: scriptedProvider([
        {
          toolCalls: [
            echoCall("a", "1"),
            echoCall("b", "2"),
            echoCall("c", "3"),
            echoCall("d", "4"),
          ],
        },
        { text: "done" },
      ]),
      tools: [tool],
      maxConcurrentTools: 2,
    });
    await collect(agent.stream("go"));
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// 2.7 — structured termination (stopTool)
// ────────────────────────────────────────────────────────────────────

describe("stopTool", () => {
  it("validates and returns the stop tool input as the final output", async () => {
    const agent = new Agent({
      model: scriptedProvider([{ toolCalls: [submitCall("hello")] }]),
      stopTool: STOP_TOOL,
    });
    const events = await collect(agent.stream("go"));
    const final = events.at(-1);
    if (final?.type === "final") expect(final.stopToolInput).toEqual({ answer: "hello" });
    // The stop tool is never executed → no tool_call/tool_result for it.
    expect(events.some((e) => e.type === "tool_call")).toBe(false);
  });

  it("throws AgentStopToolValidationError (preserving the validator error as cause)", async () => {
    const agent = new Agent({
      model: scriptedProvider([{ toolCalls: [submitCall(42)] }]),
      stopTool: STOP_TOOL,
    });
    try {
      await collect(agent.stream("go"));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AgentStopToolValidationError);
      expect((err as { cause?: Error }).cause).toBeInstanceOf(Error);
      expect(((err as { cause?: Error }).cause as Error).message).toMatch(
        /answer must be a string/,
      );
    }
  });

  it("throws AgentNoStopToolError on a no-tool turn when a stop tool is configured", async () => {
    const agent = new Agent({
      model: scriptedProvider([{ text: "I refuse to call anything" }]),
      stopTool: STOP_TOOL,
    });
    await expect(collect(agent.stream("go"))).rejects.toBeInstanceOf(AgentNoStopToolError);
  });

  it("rejects a stop tool whose name collides with a registered tool", () => {
    expect(
      () =>
        new Agent({
          model: scriptedProvider([]),
          tools: [echoTool()],
          stopTool: { ...STOP_TOOL, name: "echo" },
        }),
    ).toThrow(/collides/);
  });
});

// ────────────────────────────────────────────────────────────────────
// 3.1 — hooks
// ────────────────────────────────────────────────────────────────────

describe("hooks", () => {
  it("fires before/afterModelCall and before/afterToolCall in order", async () => {
    const order: string[] = [];
    const agent = new Agent({
      model: scriptedProvider([{ toolCalls: [echoCall("hi")] }, { toolCalls: [submitCall("ok")] }]),
      tools: [echoTool()],
      stopTool: STOP_TOOL,
      hooks: {
        beforeModelCall: (ctx) => {
          order.push(`beforeModel:${ctx.iteration}`);
        },
        afterModelCall: (ctx) => {
          order.push(`afterModel:${ctx.iteration}`);
        },
        beforeToolCall: (ctx) => {
          order.push(`beforeTool:${ctx.toolCall.name}`);
        },
        afterToolCall: (ctx) => {
          order.push(`afterTool:${ctx.toolCall.name}:${ctx.isError}`);
        },
      },
    });
    await collect(agent.stream("go"));
    expect(order).toEqual([
      "beforeModel:1",
      "afterModel:1",
      "beforeTool:echo",
      "afterTool:echo:false",
      "beforeModel:2",
      "afterModel:2",
    ]);
  });

  it("beforeToolCall { skip } vetoes execution and feeds the string back", async () => {
    const tool = echoTool(async () => {
      throw new Error("must not execute");
    });
    const agent = new Agent({
      model: scriptedProvider([
        { toolCalls: [echoCall("x")] },
        { toolCalls: [submitCall("done")] },
      ]),
      tools: [tool],
      stopTool: STOP_TOOL,
      hooks: { beforeToolCall: () => ({ skip: "denied by policy" }) },
    });
    const events = await collect(agent.stream("go"));
    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult?.type).toBe("tool_result");
    if (toolResult?.type === "tool_result") {
      expect(toolResult.isError).toBe(false);
      expect(toolResult.output).toBe("denied by policy");
    }
    // Final still reached (model submitted on turn 2).
    expect(events.at(-1)?.type).toBe("final");
  });

  it("a throwing hook fails the run", async () => {
    const agent = new Agent({
      model: scriptedProvider([{ toolCalls: [submitCall("ok")] }]),
      stopTool: STOP_TOOL,
      hooks: {
        beforeModelCall: () => {
          throw new Error("guardrail tripped");
        },
      },
    });
    await expect(collect(agent.stream("go"))).rejects.toThrow(/guardrail tripped/);
  });

  it("onRunError fires once on failure with the error and partial usage", async () => {
    const calls: Array<{ message: string; inputTokens: number }> = [];
    const provider: ModelProvider = {
      provider: "fake",
      modelId: "fake-1",
      generate: async () => {
        throw new Error("provider exploded");
      },
    };
    const agent = new Agent({
      model: provider,
      hooks: {
        onRunError: (ctx) => {
          calls.push({
            message: ctx.error instanceof Error ? ctx.error.message : String(ctx.error),
            inputTokens: ctx.usage.inputTokens,
          });
        },
      },
    });
    await expect(collect(agent.stream("go"))).rejects.toThrow(/provider exploded/);
    expect(calls).toEqual([{ message: "provider exploded", inputTokens: 0 }]);
  });

  it("a throwing onRunError is swallowed and never masks the original error", async () => {
    const agent = new Agent({
      model: scriptedProvider([{ text: "no tools" }]),
      stopTool: STOP_TOOL, // no-tool turn → AgentNoStopToolError
      hooks: {
        onRunError: () => {
          throw new Error("cleanup blew up");
        },
      },
    });
    await expect(collect(agent.stream("go"))).rejects.toThrow(/without calling the stop tool/i);
  });
});

// ────────────────────────────────────────────────────────────────────
// 3.2 — multi-turn
// ────────────────────────────────────────────────────────────────────

describe("multi-turn", () => {
  it("accepts a prior transcript and the model sees it", async () => {
    const captured: ModelRequest[] = [];
    const provider: ModelProvider = {
      provider: "fake",
      modelId: "fake-1",
      generate: async (req): Promise<ModelResponse> => {
        captured.push({ ...req, messages: [...req.messages] });
        return {
          text: "answer",
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          stopReason: "stop",
        };
      },
    };
    const agent = new Agent({ model: provider });
    const prior = [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1", toolCalls: [] },
    ] as const;
    await collect(agent.stream([...prior, { role: "user", content: "q2" }]));
    expect(captured[0]?.messages).toHaveLength(3);
    expect(captured[0]?.messages[0]).toEqual({ role: "user", content: "q1" });
  });

  it("final.messages returns the full transcript for continuation", async () => {
    const agent = new Agent({ model: scriptedProvider([{ text: "first" }]) });
    const events = await collect(agent.stream("hello"));
    const final = events.at(-1);
    expect(final?.type).toBe("final");
    if (final?.type === "final") {
      // user("hello") + assistant("first")
      expect(final.messages).toHaveLength(2);
      expect(final.messages[0]).toEqual({ role: "user", content: "hello" });
      expect(final.messages[1]).toMatchObject({ role: "assistant", content: "first" });
    }
  });
});
