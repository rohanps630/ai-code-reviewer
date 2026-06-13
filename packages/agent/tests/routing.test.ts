import { describe, expect, it } from "vitest";
import { routeModel } from "../src/loop.js";

describe("routeModel", () => {
  it("routes trivial diffs to haiku", () => {
    // Trivial: < 25 changed lines, 1 file, no API surface changes
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

  // ── BUG-3 regression: route on *changed* lines, not total diff length ──

  it("treats a small edit buried in lots of context as trivial (haiku)", () => {
    // A single 2-line edit surrounded by ~30 lines of unchanged context. By
    // total-line count this is 30+ lines → sonnet; by changed-line count it's
    // 2 lines → haiku, which is correct.
    const context = Array.from({ length: 30 }, (_, i) => ` unchanged line ${i}`);
    const diff = [
      "diff --git a/src/big.ts b/src/big.ts",
      "index 123456..789012 100644",
      "--- a/src/big.ts",
      "+++ b/src/big.ts",
      "@@ -1,32 +1,32 @@",
      ...context.slice(0, 15),
      "-const a = 1;",
      "+const a = 2;",
      ...context.slice(15),
    ].join("\n");
    expect(routeModel(diff)).toBe("haiku");
  });

  it("does not count +++/--- file headers as changed lines", () => {
    // 24 real edits + the +++/--- headers. If headers counted, this would tip
    // past the 25-line trivial threshold; they must not.
    const edits = Array.from({ length: 24 }, (_, i) => `+const v${i} = ${i};`);
    const diff = [
      "diff --git a/src/x.ts b/src/x.ts",
      "--- a/src/x.ts",
      "+++ b/src/x.ts",
      "@@ -1,1 +1,25 @@",
      ...edits,
    ].join("\n");
    expect(routeModel(diff)).toBe("haiku");
  });

  it("escalates to opus once changed lines exceed the threshold", () => {
    const edits = Array.from({ length: 260 }, (_, i) => `+const v${i} = ${i};`);
    const diff = ["diff --git a/src/x.ts b/src/x.ts", "+++ b/src/x.ts", ...edits].join("\n");
    expect(routeModel(diff)).toBe("opus");
  });
});
