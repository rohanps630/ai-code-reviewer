import { describe, expect, it } from "vitest";
import { routeModel } from "../src/loop.js";

describe("routeModel", () => {
  it("routes trivial diffs to haiku", () => {
    // Trivial: < 50 lines, 1 file, no API surface changes
    const trivialDiff = [
      "diff --git a/src/index.ts b/src/index.ts",
      "index 123456..789012 100644",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1,3 +1,3 @@",
      " const x = 1;",
      "-console.log(x);",
      "+console.log(x + 1);",
    ].join("\n");
    expect(routeModel(trivialDiff)).toBe("haiku");
  });

  it("routes diffs with public API changes to sonnet even if short", () => {
    const apiDiff = [
      "diff --git a/src/index.ts b/src/index.ts",
      "index 123456..789012 100644",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1,3 +1,3 @@",
      "-const x = 1;",
      "+export const x = 1;",
    ].join("\n");
    expect(routeModel(apiDiff)).toBe("sonnet");
  });

  it("routes standard diffs to sonnet", () => {
    // Standard: > 50 lines but <= 500 lines, or multi-file up to 5 files
    const lines = [];
    lines.push("diff --git a/src/file1.ts b/src/file1.ts");
    lines.push("diff --git a/src/file2.ts b/src/file2.ts");
    for (let i = 0; i < 60; i++) {
      lines.push(`+line ${i}`);
    }
    expect(routeModel(lines.join("\n"))).toBe("sonnet");
  });

  it("routes complex diffs (> 500 lines) to opus", () => {
    const lines = [];
    lines.push("diff --git a/src/file.ts b/src/file.ts");
    for (let i = 0; i < 550; i++) {
      lines.push(`+line ${i}`);
    }
    expect(routeModel(lines.join("\n"))).toBe("opus");
  });

  it("routes complex diffs (> 5 files changed) to opus", () => {
    const lines = [];
    for (let f = 1; f <= 6; f++) {
      lines.push(`diff --git a/src/file${f}.ts b/src/file${f}.ts`);
      lines.push(`+++ b/src/file${f}.ts`);
      lines.push("+const x = 1;");
    }
    expect(routeModel(lines.join("\n"))).toBe("opus");
  });
});
