import { describe, expect, it, vi } from "vitest";
import { fetchPr } from "../src/pr-fetcher.js";

const mockGet = vi.fn();
const mockListFiles = vi.fn();
const mockIterator = vi.fn();

vi.mock("octokit", () => ({
  Octokit: vi.fn(() => ({
    rest: {
      pulls: {
        get: mockGet,
        listFiles: mockListFiles,
      },
    },
    paginate: {
      iterator: mockIterator,
    },
  })),
}));

describe("pr-fetcher", () => {
  it("should fetch PR metadata and files correctly", async () => {
    mockGet.mockResolvedValue({
      data: {
        title: "Test PR",
        body: "Test Body",
        head: { sha: "head123" },
        base: { sha: "base123" },
      },
    });

    async function* mockGenerator() {
      yield {
        data: [
          { filename: "test.ts", status: "added", patch: "@@ -0,0 +1,1 @@\n+added" },
        ],
      };
    }
    mockIterator.mockReturnValue(mockGenerator());

    const result = await fetchPr({ owner: "test", repo: "test", pullNumber: 1, token: "token" });
    
    expect(result).toEqual({
      owner: "test",
      repo: "test",
      pullNumber: 1,
      title: "Test PR",
      body: "Test Body",
      headSha: "head123",
      baseSha: "base123",
      files: [
        { filename: "test.ts", previous_filename: undefined, status: "added", patch: "@@ -0,0 +1,1 @@\n+added" },
      ],
    });
  });
});
