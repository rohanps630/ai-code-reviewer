import { describe, expect, it, vi } from "vitest";
import { submitReview } from "../src/review-submitter.js";

const mockCreateReview = vi.fn();

vi.mock("octokit", () => ({
  Octokit: vi.fn(() => ({
    rest: {
      pulls: {
        createReview: mockCreateReview,
      },
    },
  })),
}));

describe("review-submitter", () => {
  it("should group inline comments and demote overflow", async () => {
    mockCreateReview.mockResolvedValue({});

    const findings = Array.from({ length: 35 }).map((_, i) => ({
      mapped: { kind: "inline" as const, path: `file${i}.ts`, line: 10, side: "RIGHT" as const },
      original: { summary: `test${i}`, category: "bug", severity: "major" },
    }));

    findings.push({
      mapped: { kind: "demoted" as const, reason: "outside patch" },
      original: { summary: "demoted_test", category: "logic", severity: "critical" },
    });

    await submitReview({
      owner: "test",
      repo: "test",
      pullNumber: 1,
      token: "token",
      headSha: "sha123",
      summary: "Global summary",
      findings,
    });

    expect(mockCreateReview).toHaveBeenCalledTimes(1);
    const callArg = mockCreateReview.mock.calls[0][0];
    
    expect(callArg.owner).toBe("test");
    expect(callArg.repo).toBe("test");
    expect(callArg.pull_number).toBe(1);
    expect(callArg.commit_id).toBe("sha123");
    expect(callArg.event).toBe("COMMENT");
    
    // Exactly 30 inline comments
    expect(callArg.comments).toHaveLength(30);
    expect(callArg.comments[0].path).toBe("file0.ts");

    // Body should contain the summary and the demoted items
    expect(callArg.body).toContain("Global summary");
    expect(callArg.body).toContain("### Additional Findings");
    // 5 overflowed inline comments
    expect(callArg.body).toContain("file30.ts:10 - test30");
    expect(callArg.body).toContain("file34.ts:10 - test34");
    // 1 explicitly demoted finding
    expect(callArg.body).toContain("(Demoted: outside patch) - demoted_test");
  });
});
