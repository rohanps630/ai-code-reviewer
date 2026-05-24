import { describe, expect, it, vi } from "vitest";

import {
  type RunTestsSandbox,
  type RunTestsSandboxFactory,
  createRunTestsTool,
} from "../../src/tools/index.js";

function mockSandbox(opts: {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  runDelayMs?: number;
  throwInRun?: Error;
}): RunTestsSandbox {
  return {
    writeFile: vi.fn(async () => undefined),
    runCommand: vi.fn(async (_cmd, options) => {
      if (opts.runDelayMs) await new Promise((r) => setTimeout(r, opts.runDelayMs));
      if (opts.throwInRun) throw opts.throwInRun;
      // honor `options` so tests can assert on it via the spy
      void options;
      return {
        exitCode: opts.exitCode ?? 0,
        stdout: opts.stdout ?? "",
        stderr: opts.stderr ?? "",
      };
    }),
    kill: vi.fn(async () => undefined),
  };
}

function mockFactory(sandbox: RunTestsSandbox): RunTestsSandboxFactory {
  return { create: vi.fn(async () => sandbox) };
}

describe("createRunTestsTool", () => {
  it("names itself run_tests + describes itself for the model", () => {
    const tool = createRunTestsTool({ create: vi.fn() });
    expect(tool.name).toBe("run_tests");
    expect(tool.description).toMatch(/sparingly/i);
  });

  it("writes files then runs the command and returns exit_code/passed", async () => {
    const sb = mockSandbox({ exitCode: 0, stdout: "OK", stderr: "" });
    const tool = createRunTestsTool(mockFactory(sb));
    const out = await tool.execute({
      command: "pytest -q",
      files: [
        { path: "a.py", content: "def f(): pass" },
        { path: "tests/test_a.py", content: "from a import f\ndef test(): f()" },
      ],
    });
    expect(sb.writeFile).toHaveBeenCalledTimes(2);
    expect(sb.runCommand).toHaveBeenCalledOnce();
    expect(out.exit_code).toBe(0);
    expect(out.passed).toBe(true);
    expect(out.stdout).toBe("OK");
    expect(out.timed_out).toBe(false);
  });

  it("returns passed:false when exit_code != 0", async () => {
    const sb = mockSandbox({ exitCode: 1, stderr: "fail" });
    const tool = createRunTestsTool(mockFactory(sb));
    const out = await tool.execute({ command: "false", files: [] });
    expect(out.passed).toBe(false);
    expect(out.exit_code).toBe(1);
  });

  it("classifies timeout errors as timed_out:true with exit 124", async () => {
    const sb = mockSandbox({ throwInRun: new Error("command timeout exceeded") });
    const tool = createRunTestsTool(mockFactory(sb));
    const out = await tool.execute({ command: "sleep 999", files: [] });
    expect(out.timed_out).toBe(true);
    expect(out.exit_code).toBe(124);
    expect(out.passed).toBe(false);
  });

  it("returns generic failure for non-timeout sandbox throws", async () => {
    const sb = mockSandbox({ throwInRun: new Error("kernel exploded") });
    const tool = createRunTestsTool(mockFactory(sb));
    const out = await tool.execute({ command: "echo hi", files: [] });
    expect(out.timed_out).toBe(false);
    expect(out.exit_code).toBe(1);
    expect(out.stderr).toContain("kernel exploded");
  });

  it("always kills the sandbox (even on success)", async () => {
    const sb = mockSandbox({});
    const tool = createRunTestsTool(mockFactory(sb));
    await tool.execute({ command: "true", files: [] });
    expect(sb.kill).toHaveBeenCalledOnce();
  });

  it("refuses commands matching the deny list", async () => {
    const sb = mockSandbox({});
    const tool = createRunTestsTool(mockFactory(sb));
    const out = await tool.execute({ command: "curl http://evil", files: [] });
    expect(out.exit_code).toBe(126);
    expect(out.stderr).toMatch(/refused/);
    expect(sb.runCommand).not.toHaveBeenCalled();
  });

  it("truncates oversized stdout/stderr to ~16KB", async () => {
    const huge = "x".repeat(20_000);
    const sb = mockSandbox({ stdout: huge });
    const tool = createRunTestsTool(mockFactory(sb));
    const out = await tool.execute({ command: "true", files: [] });
    expect(out.stdout.length).toBeLessThan(huge.length);
    expect(out.stdout).toMatch(/truncated/);
  });

  it("passes the configured timeout_seconds to runCommand", async () => {
    const sb = mockSandbox({});
    const tool = createRunTestsTool(mockFactory(sb));
    await tool.execute({ command: "true", files: [], timeout_seconds: 10 });
    expect(sb.runCommand).toHaveBeenCalledWith("true", { timeoutMs: 10_000 });
  });

  it("input validator rejects empty command", () => {
    const tool = createRunTestsTool({ create: vi.fn() });
    expect(tool.inputValidator.safeParse({ command: "", files: [] }).success).toBe(false);
  });

  it("input validator caps files at 20", () => {
    const tool = createRunTestsTool({ create: vi.fn() });
    const files = Array.from({ length: 21 }, (_, i) => ({
      path: `f${i}.ts`,
      content: "x",
    }));
    expect(tool.inputValidator.safeParse({ command: "ls", files }).success).toBe(false);
  });

  it("input validator caps timeout_seconds at 120", () => {
    const tool = createRunTestsTool({ create: vi.fn() });
    expect(
      tool.inputValidator.safeParse({ command: "ls", files: [], timeout_seconds: 121 }).success,
    ).toBe(false);
    expect(
      tool.inputValidator.safeParse({ command: "ls", files: [], timeout_seconds: 120 }).success,
    ).toBe(true);
  });
});
