#!/usr/bin/env node
// biome-ignore lint/suspicious/noConsole: CLI tool needs to print output
import { parseArgs } from "node:util";
import { anthropic, runReview } from "@acr/agent";
import {
  CommentableSet,
  type FindingInput,
  buildReviewPayload,
  fetchPr,
  mapFinding,
  submitReview,
} from "@acr/github";
import { LocalCodeSource, LocalRetriever } from "./local/index.js";

async function main() {
  const { values } = parseArgs({
    options: {
      pr: { type: "string" },
      "dry-run": { type: "boolean" },
    },
    allowPositionals: true,
  });

  const prUrl = values.pr;
  if (!prUrl) {
    console.error("Usage: acr-review --pr <url> [--dry-run]");
    process.exit(1);
  }

  // Parse PR URL e.g. https://github.com/owner/repo/pull/123
  const match = prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
  if (!match) {
    console.error("Invalid PR URL format");
    process.exit(1);
  }
  const [, ownerMatch, repoMatch, pullNumStr] = match;
  const owner = ownerMatch as string;
  const repo = repoMatch as string;
  const pullNumber = Number.parseInt(pullNumStr as string, 10);

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN is required");
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is required");
    process.exit(1);
  }
  const pr = await fetchPr({ owner, repo, pullNumber, token });

  const diff = pr.files
    .map(
      (f: { previous_filename?: string; filename: string; patch?: string }) =>
        `--- a/${f.previous_filename || f.filename}\n+++ b/${f.filename}\n${f.patch}`,
    )
    .join("\n\n");
  const commentableSet = new CommentableSet(pr.files);

  const provider = anthropic("claude-3-5-sonnet-20241022", { apiKey });
  const retriever = new LocalRetriever();
  const codeSource = new LocalCodeSource();

  const generator = runReview(
    { diff, model: "auto" },
    {
      provider,
      retriever,
      codeSource,
      hooks: {
        beforeToolCall: async (_ctx: unknown) => {},
      },
    },
  );

  let result: unknown;
  for await (const event of generator) {
    if (event.type === "final") {
      result = (event as { output: unknown }).output;
    }
  }

  if (!result || typeof result !== "object" || !("findings" in result)) {
    console.error("Agent failed to return valid findings.");
    process.exit(1);
  }
  const output = result as { summary: string; findings: FindingInput[] };
  const mappedFindings = output.findings.map((finding) => ({
    mapped: mapFinding(finding, commentableSet),
    original: finding,
  }));

  if (values["dry-run"]) {
    const payload = buildReviewPayload({
      summary: output.summary,
      findings: mappedFindings,
    });
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(JSON.stringify(payload, null, 2));
    process.exit(0);
  }

  await submitReview({
    owner: owner as string,
    repo: repo as string,
    pullNumber,
    token,
    headSha: pr.headSha,
    summary: output.summary,
    findings: mappedFindings,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
