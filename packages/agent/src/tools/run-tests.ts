/**
 * run_tests — execute commands inside an E2B sandbox.
 *
 * ⚠️  PROTECTED FILE — see AGENTS.md § 7.
 *
 * The model uses this sparingly — running tests costs real seconds
 * and real money. Reserve it for changes where the runtime behavior
 * is the actual question (e.g. "this changed a regex; do the existing
 * tests still pass?").
 *
 * Why E2B:
 *   - Isolated VM per call; no risk to the host.
 *   - Stateless: no persistent filesystem between calls (we recreate
 *     the file under review every time).
 *   - Time-boxed: we cap each call's lifetime so a hung test can't
 *     drain budget.
 *
 * What we accept and what we don't:
 *   - Accept a small set of files to materialize into the sandbox.
 *   - Accept a shell command to run.
 *   - REJECT inputs that look like they want to reach the network
 *     beyond what the test harness needs. v1 enforcement is just a
 *     deny list of substrings in the command — coarse but enough to
 *     stop the obvious prompt-injection footguns. Phase 5 (production
 *     concerns) will replace this with proper egress controls inside
 *     the sandbox.
 *
 * The Sandbox factory is constructor-injected so tests pass a stub.
 */

import { z } from "zod";

import type { JsonSchemaObject, Tool } from "./types.js";

const FileSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(200_000),
});

const InputSchema = z.object({
  command: z.string().min(1, "command must not be empty").max(500, "command must be <= 500 chars"),
  files: z.array(FileSchema).max(20, "at most 20 files per run_tests call"),
  timeout_seconds: z.number().int().positive().max(120).optional(),
});

type RunTestsInput = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  exit_code: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  duration_ms: z.number().int().nonnegative(),
  /** True iff exit_code === 0 within the timeout. */
  passed: z.boolean(),
  /** True iff the command was killed by the timeout. */
  timed_out: z.boolean(),
});

type RunTestsOutput = z.infer<typeof OutputSchema>;

const INPUT_JSON_SCHEMA: JsonSchemaObject = {
  type: "object",
  required: ["command", "files"],
  properties: {
    command: {
      type: "string",
      description:
        "Shell command to run inside the sandbox, e.g. 'pytest tests/test_auth.py -q'. " +
        "Must complete within `timeout_seconds`. Network egress is restricted.",
    },
    files: {
      type: "array",
      maxItems: 20,
      description: "Files to materialize into the sandbox before the command runs.",
      items: {
        type: "object",
        required: ["path", "content"],
        properties: {
          path: {
            type: "string",
            description: "Sandbox-relative path. Parent directories are created as needed.",
          },
          content: {
            type: "string",
            description: "File content as UTF-8 text. Max 200000 chars.",
          },
        },
      },
    },
    timeout_seconds: {
      type: "integer",
      minimum: 1,
      maximum: 120,
      description: "Per-call timeout. Default 60s. Hard ceiling 120s.",
    },
  },
};

/** Minimal contract over E2B's sandbox so this file doesn't pin
 *  to a specific SDK shape. Real sandboxes are constructed via
 *  the factory below; tests pass a hand-rolled stub. */
export interface RunTestsSandbox {
  writeFile: (path: string, content: string) => Promise<void>;
  runCommand: (
    command: string,
    options: { timeoutMs: number },
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  kill: () => Promise<void>;
}

export interface RunTestsSandboxFactory {
  create: () => Promise<RunTestsSandbox>;
}

// Substrings in `command` that auto-deny. Coarse but stops the obvious
// "curl evil.com" / "rm -rf /" prompt-injection attempts. Phase 5 adds
// real egress control inside the sandbox.
const COMMAND_DENY_LIST: readonly string[] = [
  "curl ",
  "wget ",
  "nc ",
  "netcat ",
  "rm -rf /",
  "/etc/passwd",
  "/etc/shadow",
  "iptables",
  "ssh ",
  "scp ",
];

export function createRunTestsTool(
  factory: RunTestsSandboxFactory,
): Tool<RunTestsInput, RunTestsOutput> {
  return {
    name: "run_tests",
    description:
      "Run a shell command inside an isolated sandbox after writing a small " +
      "set of files into it. Use SPARINGLY — this is the slowest and most " +
      "expensive tool. Reserve it for changes where running the existing " +
      "tests actually answers the question (e.g. 'does this regex change " +
      "still pass tests/parser_test.py?'). Returns exit code + captured " +
      "stdout/stderr. Times out at the limit you set (max 120s).",
    inputSchema: INPUT_JSON_SCHEMA,
    inputValidator: InputSchema,
    outputValidator: OutputSchema,
    execute: async (input) => {
      const denied = COMMAND_DENY_LIST.find((needle) => input.command.includes(needle));
      if (denied) {
        return {
          exit_code: 126,
          stdout: "",
          stderr: `run_tests: refused command containing '${denied.trim()}'`,
          duration_ms: 0,
          passed: false,
          timed_out: false,
        };
      }

      const timeoutSec = input.timeout_seconds ?? 60;
      const timeoutMs = timeoutSec * 1000;

      const sandbox = await factory.create();
      const start = Date.now();
      try {
        for (const file of input.files) {
          await sandbox.writeFile(file.path, file.content);
        }
        const result = await sandbox.runCommand(input.command, { timeoutMs });
        const durationMs = Date.now() - start;
        return {
          exit_code: result.exitCode,
          stdout: truncate(result.stdout, 16_000),
          stderr: truncate(result.stderr, 16_000),
          duration_ms: durationMs,
          passed: result.exitCode === 0,
          timed_out: false,
        };
      } catch (err) {
        const durationMs = Date.now() - start;
        const message = err instanceof Error ? err.message : String(err);
        const timedOut = /timeout/i.test(message);
        return {
          exit_code: timedOut ? 124 : 1,
          stdout: "",
          stderr: message,
          duration_ms: durationMs,
          passed: false,
          timed_out: timedOut,
        };
      } finally {
        await sandbox.kill().catch(() => undefined);
      }
    },
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…(truncated, ${s.length - max} more chars)`;
}

/** Default factory backed by the real E2B SDK. Constructed lazily so
 *  the SDK isn't required at import time. Server-only. */
export async function defaultE2BFactory(apiKey: string): Promise<RunTestsSandboxFactory> {
  if (!apiKey) throw new Error("defaultE2BFactory: apiKey is required");
  const { Sandbox } = await import("@e2b/code-interpreter");
  return {
    create: async () => {
      const sb = await Sandbox.create({ apiKey });
      return adaptSandbox(sb);
    },
  };
}

// Adapter from E2B's SDK to our narrow contract. Kept here (not in the
// factory) so the runtime shape mismatch surfaces in one place if the
// SDK changes.
type E2BLike = {
  files?: { write?: (path: string, content: string) => Promise<unknown> };
  commands?: {
    run?: (
      cmd: string,
      opts?: { timeoutMs?: number },
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
  kill?: () => Promise<unknown>;
};

function adaptSandbox(sb: unknown): RunTestsSandbox {
  const s = sb as E2BLike;
  return {
    writeFile: async (path, content) => {
      if (!s.files?.write) throw new Error("E2B sandbox missing files.write");
      await s.files.write(path, content);
    },
    runCommand: async (command, opts) => {
      if (!s.commands?.run) throw new Error("E2B sandbox missing commands.run");
      const r = await s.commands.run(command, { timeoutMs: opts.timeoutMs });
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
    },
    kill: async () => {
      if (s.kill) await s.kill();
    },
  };
}
