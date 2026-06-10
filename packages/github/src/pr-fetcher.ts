import { Octokit } from "octokit";
import { z } from "zod";

export const PrFetchOptionsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  pullNumber: z.number().int().positive(),
  token: z.string(),
});

export type PrFetchOptions = z.infer<typeof PrFetchOptionsSchema>;

export interface PrFile {
  filename: string;
  previous_filename?: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  patch?: string; // Unified diff patch for this file
}

export interface PrMetadata {
  owner: string;
  repo: string;
  pullNumber: number;
  title: string;
  body: string;
  headSha: string;
  baseSha: string;
  files: PrFile[];
}

export async function fetchPr(options: PrFetchOptions): Promise<PrMetadata> {
  const { owner, repo, pullNumber, token } = PrFetchOptionsSchema.parse(options);
  const octokit = new Octokit({ auth: token });

  const { data: pull } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  const files: PrFile[] = [];
  const iterator = octokit.paginate.iterator(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  for await (const response of iterator) {
    for (const file of response.data) {
      files.push({
        filename: file.filename,
        previous_filename: file.previous_filename,
        status: file.status as PrFile["status"],
        patch: file.patch,
      });
    }
  }

  return {
    owner,
    repo,
    pullNumber,
    title: pull.title,
    body: pull.body ?? "",
    headSha: pull.head.sha,
    baseSha: pull.base.sha,
    files,
  };
}
