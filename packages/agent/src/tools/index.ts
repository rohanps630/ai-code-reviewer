/**
 * Tools — public surface.
 *
 * ⚠️  PROTECTED FILE — see AGENTS.md § 7.
 *
 * Phase 3 ships tools one at a time:
 *   3.2  search_code        — wraps hybrid retrieval
 *   3.3  read_file          — pull a document by path
 *   3.3  find_references    — symbol cross-refs via BM25
 *   3.5  run_tests          — E2B sandbox
 *
 * Each tool is its own file. This barrel re-exports the framework
 * plus the registered tools so callers (loop.ts, tests) get a single
 * import.
 */

// Framework
export type {
  Tool,
  ToolDefinition,
  ToolCallRequest,
  ToolCallResult,
  JsonSchemaObject,
} from "./types.js";
export {
  UnknownToolError,
  ToolInputValidationError,
  ToolOutputValidationError,
} from "./types.js";

export type { ToolRegistry, AnthropicTool } from "./registry.js";
export { buildToolRegistry, toAnthropicTools, executeToolCall } from "./registry.js";

// Tools
export { createSearchCodeTool } from "./search-code.js";
export type { SearchCodeRetriever } from "./search-code.js";

export { createReadFileTool } from "./read-file.js";
export type { ReadFileExecutor } from "./read-file.js";

export { createFindReferencesTool } from "./find-references.js";
export type { FindReferencesExecutor } from "./find-references.js";

export { createRunTestsTool, defaultE2BFactory } from "./run-tests.js";
export type { RunTestsSandbox, RunTestsSandboxFactory } from "./run-tests.js";
