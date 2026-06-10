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
        data: [{ filename: "test.ts", status: "added", patch: "@@ -0,0 +1,1 @@\n+added" }],
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
        {
          filename: "test.ts",
          previous_filename: undefined,
          status: "added",
          patch: "@@ -0,0 +1,1 @@\n+added",
        },
      ],
    });
  });

  it("should handle pagination across multiple pages", async () => {
    mockGet.mockResolvedValue({
      data: {
        title: "Large PR",
        body: "",
        head: { sha: "head1" },
        base: { sha: "base1" },
      },
    });

    async function* paginatedGenerator() {
      yield {
        data: [{ filename: "file1.ts", status: "added", patch: "patch1" }],
      };
      yield {
        data: [{ filename: "file2.ts", status: "modified", patch: "patch2" }],
      };
    }
    mockIterator.mockReturnValue(paginatedGenerator());

    const result = await fetchPr({ owner: "test", repo: "test", pullNumber: 2, token: "token" });
    expect(result.files).toHaveLength(2);
    expect(result.files[0]?.filename).toBe("file1.ts");
    expect(result.files[1]?.filename).toBe("file2.ts");
  });

  it("should handle file renames and binary files", async () => {
    mockGet.mockResolvedValue({
      data: {
        title: "Rename PR",
        body: "",
        head: { sha: "head2" },
        base: { sha: "base2" },
      },
    });

    async function* mockGenerator() {
      yield {
        data: [
          {
            filename: "new_name.ts",
            previous_filename: "old_name.ts",
            status: "renamed",
            patch: "patch_rename",
          },
          { filename: "image.png", status: "added", patch: undefined }, // Binary file lacks patch
        ],
      };
    }
    mockIterator.mockReturnValue(mockGenerator());

    const result = await fetchPr({ owner: "test", repo: "test", pullNumber: 3, token: "token" });
    expect(result.files).toHaveLength(2);

    // Check renamed
    expect(result.files[0]?.filename).toBe("new_name.ts");
    expect(result.files[0]?.previous_filename).toBe("old_name.ts");

    // Check binary (no patch)
    expect(result.files[1]?.filename).toBe("image.png");
    expect(result.files[1]?.patch).toBeUndefined();
  });
});
