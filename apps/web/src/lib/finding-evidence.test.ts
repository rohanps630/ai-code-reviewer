import type { Finding, ReviewChunk } from "@acr/agent";
import { describe, expect, it } from "vitest";

import { correlateEvidence, parseLocationHint } from "./finding-evidence";

describe("parseLocationHint", () => {
  it("parses path only", () => {
    expect(parseLocationHint("src/auth.ts")).toEqual({
      path: "src/auth.ts",
      startLine: undefined,
      endLine: undefined,
    });
  });

  it("parses path and single line", () => {
    expect(parseLocationHint("src/auth.ts:42")).toEqual({
      path: "src/auth.ts",
      startLine: 42,
      endLine: 42,
    });
  });

  it("parses path and line range", () => {
    expect(parseLocationHint("src/auth.ts:42-50")).toEqual({
      path: "src/auth.ts",
      startLine: 42,
      endLine: 50,
    });
  });

  it("handles empty or null gracefully", () => {
    expect(parseLocationHint(undefined)).toBeNull();
    expect(parseLocationHint("")).toBeNull();
  });
});

describe("correlateEvidence", () => {
  const baseFinding: Finding = {
    category: "bug",
    severity: "critical",
    summary: "Test finding",
  };

  it("matches search_code with exact line overlap", () => {
    const findings: Finding[] = [{ ...baseFinding, locationHint: "src/foo.ts:10-20" }];
    const chunks: ReviewChunk[] = [
      { type: "tool_call", name: "search_code", input: {} }, // index 0
      {
        type: "tool_result",
        name: "search_code",
        output: { hits: [{ path: "src/foo.ts", start_line: 10, end_line: 20 }] },
      }, // index 1
    ];

    const result = correlateEvidence(findings, chunks);
    expect(result[0]).toBeDefined();
    expect(result[0]?.[0]).toMatchObject({
      toolEventIndex: 1,
      toolName: "search_code",
      reason: "exact_line_match",
    });
  });

  it("matches read_file as a file_match", () => {
    const findings: Finding[] = [{ ...baseFinding, locationHint: "src/foo.ts:10-20" }];
    const chunks: ReviewChunk[] = [
      { type: "tool_call", name: "read_file", input: {} }, // 0
      { type: "tool_result", name: "read_file", output: { found: true, path: "src/foo.ts" } }, // 1
    ];

    const result = correlateEvidence(findings, chunks);
    expect(result[0]).toBeDefined();
    expect(result[0]?.[0]).toMatchObject({
      toolEventIndex: 1,
      toolName: "read_file",
      reason: "file_match",
    });
  });

  it("handles partial overlaps properly", () => {
    const findings: Finding[] = [{ ...baseFinding, locationHint: "src/foo.ts:15" }];
    const chunks: ReviewChunk[] = [
      { type: "tool_call", name: "find_references", input: {} },
      {
        type: "tool_result",
        name: "find_references",
        output: { references: [{ path: "src/foo.ts", start_line: 10, end_line: 20 }] },
      },
    ];

    const result = correlateEvidence(findings, chunks);
    expect(result[0]?.[0]?.reason).toBe("partial_line_overlap");
  });

  it("gracefully ignores malformed tool outputs", () => {
    const findings: Finding[] = [{ ...baseFinding, locationHint: "src/foo.ts:10" }];
    const chunks: ReviewChunk[] = [
      { type: "tool_call", name: "search_code", input: {} },
      { type: "tool_result", name: "search_code", output: { garbage: true } },
    ];

    const result = correlateEvidence(findings, chunks);
    expect(result[0]).toHaveLength(0); // No evidence
  });

  it("ranks exact match over partial and file matches", () => {
    const findings: Finding[] = [{ ...baseFinding, locationHint: "src/foo.ts:10" }];
    const chunks: ReviewChunk[] = [
      { type: "tool_call", name: "dummy", input: {} },
      { type: "tool_result", name: "read_file", output: { found: true, path: "src/foo.ts" } }, // file match
      { type: "tool_call", name: "dummy", input: {} },
      {
        type: "tool_result",
        name: "search_code",
        output: { hits: [{ path: "src/foo.ts", start_line: 5, end_line: 15 }] },
      }, // partial
      { type: "tool_call", name: "dummy", input: {} },
      {
        type: "tool_result",
        name: "find_references",
        output: { references: [{ path: "src/foo.ts", start_line: 10, end_line: 10 }] },
      }, // exact
    ];

    const result = correlateEvidence(findings, chunks);
    expect(result[0]).toBeDefined();
    expect(result[0]?.length).toBe(3);
    expect(result[0]?.[0]?.reason).toBe("exact_line_match");
    expect(result[0]?.[1]?.reason).toBe("partial_line_overlap");
    expect(result[0]?.[2]?.reason).toBe("file_match");
  });
});
