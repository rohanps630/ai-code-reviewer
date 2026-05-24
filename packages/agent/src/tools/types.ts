/**
 * Tool framework — types and contracts.
 *
 * ⚠️  PROTECTED FILE — see AGENTS.md § 7.
 *
 * A `Tool` is a small, side-effectful capability the agent loop can
 * call: search_code, read_file, find_references, run_tests. Each one:
 *
 *   - Defines its name + description (the LLM reads these to decide
 *     when to call it — write them like documentation, not code
 *     comments).
 *   - Owns a JSON Schema describing its inputs (this is what Anthropic
 *     sees in the `tools` array of `messages.create`).
 *   - Owns a Zod schema for the SAME inputs (this is what we use to
 *     validate the model's tool-call arguments before invoking
 *     `execute`).
 *   - Owns a Zod schema for its outputs (defense against
 *     implementation drift; outputs that don't match the schema fail
 *     loud so the loop surfaces the bug).
 *
 * The Zod ↔ JSON Schema duality is duplication, yes. We accept it for
 * v1 because manually-written JSON Schema is easier for a human to
 * read in the prompt context than a generated blob, and there are
 * only a handful of tools. If the count grows past ~10 we can swap
 * in `zod-to-json-schema`.
 *
 * Tools must not throw on expected failure modes (file not found,
 * symbol not present, etc.). They should return a typed Result-ish
 * shape inside their output schema. Throwing is reserved for
 * unexpected failures the loop must terminate on.
 */

import type { z } from "zod";

// ────────────────────────────────────────────────────────────────────
// Tool definition + execution
// ────────────────────────────────────────────────────────────────────

/** Anthropic-compatible JSON Schema for a tool's input. Kept as
 *  `object` because the SDK accepts a plain JSON-Schema-shaped object
 *  and we don't want a hard dependency on the SDK's exact type here. */
export type JsonSchemaObject = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean | Record<string, unknown>;
  [key: string]: unknown;
};

export type ToolDefinition<TInput, TOutput> = {
  /** Tool name. Must match `/^[a-z][a-z0-9_]*$/`. Anthropic enforces
   *  the same shape on its side. */
  readonly name: string;
  /** Prompt-facing description. The model uses this to decide WHEN to
   *  call the tool — write it as a usage note, not an implementation
   *  detail. */
  readonly description: string;
  /** JSON Schema for `messages.create({ tools })`. Hand-authored so
   *  the prompt-readable shape is exact. */
  readonly inputSchema: JsonSchemaObject;
  /** Zod schema for runtime validation of tool-call arguments. */
  readonly inputValidator: z.ZodType<TInput>;
  /** Zod schema for runtime validation of `execute` results. */
  readonly outputValidator: z.ZodType<TOutput>;
};

export type Tool<TInput = unknown, TOutput = unknown> = ToolDefinition<TInput, TOutput> & {
  /** Run the tool. Must not throw for expected failure modes — encode
   *  those in the output schema instead. */
  readonly execute: (input: TInput) => Promise<TOutput>;
};

// ────────────────────────────────────────────────────────────────────
// Loop ↔ tool wire types
// ────────────────────────────────────────────────────────────────────

/** A tool call requested by the model. `id` is Anthropic's
 *  `tool_use_id` we have to echo back in the `tool_result` block. */
export type ToolCallRequest = {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
};

/** What the loop produces and ships back to the model. The shape
 *  matches what Anthropic expects in a `tool_result` content block. */
export type ToolCallResult =
  | {
      readonly id: string;
      readonly name: string;
      readonly ok: true;
      readonly output: unknown;
    }
  | {
      readonly id: string;
      readonly name: string;
      readonly ok: false;
      /** Short, model-readable error string. Goes into the prompt; keep
       *  it actionable ("file not found: foo.ts") rather than stack-y. */
      readonly error: string;
    };

// ────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────

/** Thrown by the loop when the model references a tool that isn't in
 *  the registry. Usually means a prompt drift or a stale tool name. */
export class UnknownToolError extends Error {
  public readonly toolName: string;
  constructor(toolName: string) {
    super(`Unknown tool: ${toolName}`);
    this.name = "UnknownToolError";
    this.toolName = toolName;
  }
}

/** Thrown by `executeToolCall` when input validation fails. The loop
 *  catches this and ships an `ok: false` result back to the model so
 *  it can self-correct. */
export class ToolInputValidationError extends Error {
  public readonly toolName: string;
  public readonly issues: unknown;
  constructor(toolName: string, issues: unknown) {
    super(`Invalid input for tool '${toolName}'`);
    this.name = "ToolInputValidationError";
    this.toolName = toolName;
    this.issues = issues;
  }
}

/** Thrown when a tool's `execute` returns something that doesn't
 *  satisfy `outputValidator`. This is a hard bug in the tool, not the
 *  model; surface it loud. */
export class ToolOutputValidationError extends Error {
  public readonly toolName: string;
  public readonly issues: unknown;
  constructor(toolName: string, issues: unknown) {
    super(`Tool '${toolName}' returned output that failed validation`);
    this.name = "ToolOutputValidationError";
    this.toolName = toolName;
    this.issues = issues;
  }
}
