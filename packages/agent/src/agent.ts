/**
 * Agent — a declarative, model-agnostic agentic loop.
 *
 * Inspired by the AWS Strands Agents SDK and Google ADK: configure once,
 * then call `run`. The same `Agent` and the same tools run on any
 * provider (Anthropic, OpenAI, Google, …) — swap only the `model`.
 *
 *   const agent = new Agent({
 *     model: "claude-sonnet-4-7",            // or anthropic(...) / openai(...) / google(...)
 *     tools: [searchCodeTool, readFileTool],
 *     systemPrompt: "You are the reviewer...",
 *   });
 *   const answer = await agent.run("Review this diff: ...");
 *
 * Under the hood `run` drives a ReAct loop:
 *   model → if it requested tools, execute them and feed results back →
 *   repeat until the model answers with no tool calls, or `maxIterations`
 *   is reached.
 *
 * This is a general-purpose primitive, intentionally separate from the
 * code-review `runReview` loop (loop.ts, protected). It reuses the tool
 * framework by importing it — see docs/adr/003-pluggable-agent-providers.md.
 */

import type { ZodTypeAny } from "zod";

import { type ModelLike, type ModelProvider, resolveModel } from "./providers/index.js";
import type { ModelMessage, ToolCall, ToolSpec } from "./providers/index.js";
import { type Tool, type ToolRegistry, buildToolRegistry, executeToolCall } from "./tools/index.js";
import type { JsonSchemaObject } from "./tools/index.js";

const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_MAX_TOKENS = 4096;

/**
 * A tool the `Agent` can call. Structurally compatible with the package's
 * `Tool<TInput, TOutput>` (so `createSearchCodeTool(...)` et al. pass
 * directly) while staying covariant enough to hold a mixed array without
 * casts at the call site.
 */
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaObject;
  readonly inputValidator: ZodTypeAny;
  readonly outputValidator: ZodTypeAny;
  readonly execute: (input: never) => Promise<unknown>;
}

export interface AgentConfig {
  /** A provider object, or a model-id string resolved by prefix. */
  readonly model: ModelLike;
  /** Tools the agent may call. Omit for a tool-less, single-shot agent. */
  readonly tools?: readonly AgentTool[];
  /** System instructions. */
  readonly systemPrompt?: string;
  /** Hard cap on model↔tool round-trips before giving up. Default 10. */
  readonly maxIterations?: number;
  /** Per-call token ceiling passed to the provider. Default 4096. */
  readonly maxTokens?: number;
}

/** Raised when the loop hits `maxIterations` without a final answer —
 *  usually a tool-call cycle or a model that won't stop. */
export class AgentMaxIterationsError extends Error {
  public readonly iterations: number;
  constructor(iterations: number) {
    super(`Agent did not produce a final answer within ${iterations} iterations`);
    this.name = "AgentMaxIterationsError";
    this.iterations = iterations;
  }
}

export class Agent {
  private readonly model: ModelProvider;
  private readonly tools: readonly AgentTool[];
  private readonly systemPrompt?: string;
  private readonly maxIterations: number;
  private readonly maxTokens: number;
  private readonly toolSpecs: readonly ToolSpec[];
  /** Built once at construction — immutable (ReadonlyMap), so it's safe to
   *  reuse across every `run` call (and across concurrent runs). */
  private readonly registry: ToolRegistry;

  constructor(config: AgentConfig) {
    this.model = resolveModel(config.model);
    this.tools = config.tools ?? [];
    this.systemPrompt = config.systemPrompt;
    this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    // Build the registry once. This also validates tool names + uniqueness
    // eagerly, so a bad tool array fails at construction, not mid-run.
    // why: AgentTool is the covariant public shape of Tool<TInput,TOutput>;
    // the registry only reads name/validators/execute, which both share.
    this.registry = buildToolRegistry(
      this.tools as unknown as ReadonlyArray<Tool<unknown, unknown>>,
    );
    this.toolSpecs = this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  /** Which provider/model this agent is bound to. */
  get modelId(): string {
    return this.model.modelId;
  }

  /**
   * Run the agentic loop to completion and return the model's final text.
   *
   * Throws `AgentMaxIterationsError` if the loop doesn't converge, or a
   * `ProviderError` if the model backend returns something unparsable.
   * Tool failures are NOT thrown — they're fed back to the model as error
   * results so it can self-correct (the iteration cap bounds retries).
   */
  async run(input: string): Promise<string> {
    const registry = this.registry;
    const messages: ModelMessage[] = [{ role: "user", content: input }];

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const response = await this.model.generate({
        system: this.systemPrompt,
        messages,
        tools: this.toolSpecs,
        maxTokens: this.maxTokens,
      });

      messages.push({
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls,
      });

      // No tool calls → the model is answering. We're done.
      if (response.toolCalls.length === 0) {
        return response.text;
      }

      // Execute requested tools in parallel and feed results back.
      const results = await Promise.all(
        response.toolCalls.map((call: ToolCall) =>
          executeToolCall(registry, { id: call.id, name: call.name, input: call.input }),
        ),
      );
      for (const result of results) {
        messages.push({
          role: "tool",
          toolCallId: result.id,
          toolName: result.name,
          content: result.ok ? JSON.stringify(result.output) : result.error,
          isError: !result.ok,
        });
      }
    }

    throw new AgentMaxIterationsError(this.maxIterations);
  }
}
