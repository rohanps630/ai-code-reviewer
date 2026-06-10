import { describe, expect, it } from "vitest";
import { CommentableSet, mapFinding } from "../src/diff-mapper.js";

describe("diff-mapper", () => {
  it("should map a single line addition correctly", () => {
    const patch = "@@ -10,3 +10,4 @@\n context1\n+added\n context2";
    const set = new CommentableSet([{ filename: "test.ts", status: "modified", patch }]);

    const result = mapFinding({ summary: "test", locationHint: "test.ts:11" }, set);
    expect(result).toEqual({
      kind: "inline",
      path: "test.ts",
      line: 11,
      side: "RIGHT",
      start_line: undefined,
      start_side: undefined,
    });
  });

  it("should map a single line deletion correctly", () => {
    const patch = "@@ -10,3 +10,2 @@\n context1\n-deleted\n context2";
    const set = new CommentableSet([{ filename: "test.ts", status: "modified", patch }]);

    const result = mapFinding({ summary: "test", locationHint: "test.ts:12" }, set);
    // Since deleted line (or context shifted line) only exists on the LEFT, it should map to LEFT.
    expect(result).toEqual({
      kind: "inline",
      path: "test.ts",
      line: 12,
      side: "LEFT",
      start_line: undefined,
      start_side: undefined,
    });
  });

  it("should demote finding if outside patch hunks", () => {
    const patch = "@@ -10,3 +10,4 @@\n context1\n+added\n context2";
    const set = new CommentableSet([{ filename: "test.ts", status: "modified", patch }]);

    const result = mapFinding({ summary: "test", locationHint: "test.ts:100" }, set);
    expect(result).toEqual({
      kind: "demoted",
      reason: "Line 100 in test.ts is outside the patch hunks",
    });
  });

  it("should handle multiline additions correctly", () => {
    const patch = "@@ -10,3 +10,5 @@\n context1\n+added1\n+added2\n context2";
    const set = new CommentableSet([{ filename: "test.ts", status: "modified", patch }]);

    const result = mapFinding({ summary: "test", locationHint: "test.ts:11-12" }, set);
    expect(result).toEqual({
      kind: "inline",
      path: "test.ts",
      line: 12,
      side: "RIGHT",
      start_line: 11,
      start_side: "RIGHT",
    });
  });

  it("should handle context lines mapping to RIGHT preferentially", () => {
    const patch = "@@ -10,3 +10,3 @@\n context1\n context2\n context3";
    const set = new CommentableSet([{ filename: "test.ts", status: "modified", patch }]);

    const result = mapFinding({ summary: "test", locationHint: "test.ts:11" }, set);
    expect(result).toEqual({
      kind: "inline",
      path: "test.ts",
      line: 11,
      side: "RIGHT",
      start_line: undefined,
      start_side: undefined,
    });
  });

  it("should demote if no locationHint", () => {
    const set = new CommentableSet([
      { filename: "test.ts", status: "added", patch: "@@ -0,0 +1,1 @@\n+added" },
    ]);
    const result = mapFinding({ summary: "test" }, set);
    expect(result).toEqual({ kind: "demoted", reason: "No locationHint provided" });
  });

  it("should demote if locationHint malformed", () => {
    const set = new CommentableSet([
      { filename: "test.ts", status: "added", patch: "@@ -0,0 +1,1 @@\n+added" },
    ]);
    const result = mapFinding({ summary: "test", locationHint: "test.ts" }, set);
    expect(result).toEqual({ kind: "demoted", reason: "locationHint 'test.ts' is malformed" });
  });

  it("should handle deleted file (no RIGHT side lines)", () => {
    const patch = "@@ -1,2 +0,0 @@\n-line1\n-line2";
    const set = new CommentableSet([{ filename: "test.ts", status: "removed", patch }]);

    const result = mapFinding({ summary: "test", locationHint: "test.ts:1-2" }, set);
    expect(result).toEqual({
      kind: "inline",
      path: "test.ts",
      line: 2,
      side: "LEFT",
      start_line: 1,
      start_side: "LEFT",
    });
  });
});
