/**
 * Tool registry + dispatcher.
 *
 * ⚠️  PROTECTED FILE — see AGENTS.md § 7.
 *
 *   buildToolRegistry([toolA, toolB, ...])  → Map<name, Tool>
 *   toAnthropicTools(registry)              → JSON-Schema array for the API
 *   executeToolCall(registry, callRequest)  → typed result for the loop
 *
 * The loop calls `executeToolCall` once per `tool_use` block the model
 * emits. Validation failures (input or output) are caught and turned
 * into `ok: false` results so the model can self-correct on the next
 * iteration; unexpected throws bubble up so the loop's top-level
 * termination logic sees them.
 */

import {
  type Tool,
  type ToolCallRequest,
  type ToolCallResult,
  type ToolDefinition,
  ToolInputValidationError,
  ToolOutputValidationError,
  UnknownToolError,
} from "./types.js";

/** Map<name, Tool>. Use `buildToolRegistry` to construct — it enforces
 *  that names are unique. */
export type ToolRegistry = ReadonlyMap<string, Tool<unknown, unknown>>;

const TOOL_NAME_RE = /^[a-z][a-z0-9_]*$/;

export function buildToolRegistry(tools: ReadonlyArray<Tool<unknown, unknown>>): ToolRegistry {
  const map = new Map<string, Tool<unknown, unknown>>();
  for (const tool of tools) {
    if (!TOOL_NAME_RE.test(tool.name)) {
      throw new Error(
        `Invalid tool name '${tool.name}'. Must match ${TOOL_NAME_RE} (lowercase, snake_case).`,
      );
    }
    if (map.has(tool.name)) {
      throw new Error(`Duplicate tool name in registry: '${tool.name}'`);
    }
    map.set(tool.name, tool);
  }
  return map;
}

/** Convert a registry into the shape `Anthropic.messages.create({ tools })`
 *  wants. Defined locally as a plain array of `{name, description, input_schema}`
 *  so this file doesn't take a hard dep on the Anthropic SDK types. */
export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: ToolDefinition<unknown, unknown>["inputSchema"];
};

export function toAnthropicTools(registry: ToolRegistry): AnthropicTool[] {
  return [...registry.values()].map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

/** Run a single tool call from the model. Always resolves to a
 *  `ToolCallResult` (never throws for expected failures); validation
 *  errors and tool throws both surface as `ok: false`. */
export async function executeToolCall(
  registry: ToolRegistry,
  call: ToolCallRequest,
): Promise<ToolCallResult> {
  const tool = registry.get(call.name);
  if (!tool) {
    return {
      id: call.id,
      name: call.name,
      ok: false,
      error: new UnknownToolError(call.name).message,
    };
  }

  // 1. Validate input
  const parsed = tool.inputValidator.safeParse(call.input);
  if (!parsed.success) {
    return {
      id: call.id,
      name: call.name,
      ok: false,
      error: formatZodError(call.name, "input", parsed.error.issues),
    };
  }

  // 2. Execute. Tool throws turn into `ok: false` so the model can
  //    react ("file not found: try a different path"); the loop's
  //    iteration cap is what prevents infinite retries.
  let raw: unknown;
  try {
    raw = await tool.execute(parsed.data);
  } catch (err) {
    return {
      id: call.id,
      name: call.name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 3. Validate output. This is OUR bug if it fails; throw rather
  //    than mask. The loop catches at the top level and terminates.
  const out = tool.outputValidator.safeParse(raw);
  if (!out.success) {
    throw new ToolOutputValidationError(call.name, out.error.issues);
  }

  return { id: call.id, name: call.name, ok: true, output: out.data };
}

function formatZodError(toolName: string, kind: "input" | "output", issues: unknown): string {
  const issueList = Array.isArray(issues)
    ? issues
        .map((i) => {
          const issue = i as { path?: unknown[]; message?: string };
          const where =
            Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join(".") : "<root>";
          return `${where}: ${issue.message ?? "invalid"}`;
        })
        .join("; ")
    : String(issues);
  // why: surface the tool name + section so the model can attribute the
  // failure correctly when it sees this in a tool_result.
  return `${toolName} ${kind} validation failed: ${issueList}`;
}

// Re-export the error types so the loop can do `catch { instanceof ToolInputValidationError }`
// even though it imports from this file alone.
export { ToolInputValidationError, ToolOutputValidationError, UnknownToolError };
