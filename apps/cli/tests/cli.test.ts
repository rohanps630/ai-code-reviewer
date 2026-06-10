import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("cli integration", () => {
  const cliPath = path.resolve(__dirname, "../dist/cli.js");

  it("fails if PR url is not provided", () => {
    try {
      execFileSync("node", [cliPath], { encoding: "utf8" });
      expect.fail("Should have thrown");
    } catch (e: unknown) {
      const err = e as { status: number; stdout?: string; stderr?: string; message: string };
      if (!err.stderr && !err.status && !err.stdout) throw e;
      expect((err.stdout || "") + (err.stderr || "") + err.message).toContain(
        "Usage: acr-review --pr <url>",
      );
    }
  });

  it("fails if PR url is malformed", () => {
    try {
      execFileSync("node", [cliPath, "--pr", "not-a-url"], { encoding: "utf8" });
      expect.fail("Should have thrown");
    } catch (e: unknown) {
      const err = e as { status: number; stdout?: string; stderr?: string; message: string };
      if (!err.stderr && !err.status && !err.stdout) throw e;
      expect((err.stdout || "") + (err.stderr || "") + err.message).toContain(
        "Invalid PR URL format",
      );
    }
  });

  it("fails if GITHUB_TOKEN is missing", () => {
    try {
      execFileSync("node", [cliPath, "--pr", "https://github.com/owner/repo/pull/123"], {
        encoding: "utf8",
        env: { ...process.env, GITHUB_TOKEN: "" },
      });
      expect.fail("Should have thrown");
    } catch (e: unknown) {
      const err = e as { status: number; stdout?: string; stderr?: string; message: string };
      if (!err.stderr && !err.status && !err.stdout) throw e;
      expect((err.stdout || "") + (err.stderr || "") + err.message).toContain(
        "GITHUB_TOKEN is required",
      );
    }
  });
});
