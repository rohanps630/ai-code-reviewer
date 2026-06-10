import { Octokit } from "octokit";
import { z } from "zod";
import type { MappedFinding } from "./diff-mapper.js";

export const ReviewSubmitOptionsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  pullNumber: z.number().int().positive(),
  token: z.string(),
  headSha: z.string(),
  summary: z.string(),
  findings: z.array(
    z.object({
      mapped: z.custom<MappedFinding>(),
      original: z.object({
        summary: z.string(),
        category: z.string(),
        severity: z.string(),
        suggestion: z.string().optional(),
      }),
    })
  ),
});

export type ReviewSubmitOptions = z.infer<typeof ReviewSubmitOptionsSchema>;

export async function submitReview(options: ReviewSubmitOptions): Promise<void> {
  const { owner, repo, pullNumber, token, headSha, summary, findings } = ReviewSubmitOptionsSchema.parse(options);
  const octokit = new Octokit({ auth: token });

  let body = `${summary}\n\n`;

  const comments: Array<{ path: string; side: "RIGHT" | "LEFT"; line: number; start_line?: number; start_side?: "RIGHT" | "LEFT"; body: string }> = [];
  const demoted: string[] = [];

  for (const finding of findings) {
    const { mapped, original } = finding;
    const severityPrefix = `**[${original.severity.toUpperCase()} - ${original.category}]**`;
    
    let commentBody = `${severityPrefix} ${original.summary}`;
    if (original.suggestion) {
      commentBody += `\n\n\`\`\`suggestion\n${original.suggestion}\n\`\`\``;
    }

    if (mapped.kind === "inline") {
      if (comments.length < 30) {
        const comment: any = {
          path: mapped.path,
          side: mapped.side,
          line: mapped.line,
          body: commentBody,
        };
        if (mapped.start_line !== undefined) {
          comment.start_line = mapped.start_line;
          comment.start_side = mapped.start_side;
        }
        comments.push(comment);
      } else {
        demoted.push(`- ${severityPrefix} ${mapped.path}:${mapped.line} - ${original.summary}`);
      }
    } else {
      demoted.push(`- ${severityPrefix} (Demoted: ${mapped.reason}) - ${original.summary}`);
    }
  }

  if (demoted.length > 0) {
    body += `### Additional Findings\n\n${demoted.join("\n")}\n`;
  }

  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    commit_id: headSha,
    event: "COMMENT",
    body,
    comments,
  });
}
