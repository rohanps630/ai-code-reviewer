#!/usr/bin/env node
/**
 * Test-only stand-in for scripts/agent-bridge.mjs.
 *
 * Switches behavior based on a magic marker inside the stdin diff so
 * one fixture script covers every code path the SubprocessBridge tests
 * need to exercise without spinning up the real @acr/agent.
 *
 * Markers (looked up in `envelope.diff`):
 *   __MOCK_OK__            → success envelope with a canned review
 *   __MOCK_SOFT_FAIL__     → { ok: false, error: "..." }
 *   __MOCK_BAD_JSON__      → write "not json" to stdout (parser error path)
 *   __MOCK_EMPTY__         → write nothing to stdout
 *   __MOCK_NONZERO_EXIT__  → exit code 2 with stderr message
 *   __MOCK_HANG__          → don't exit (test timeout path; pair with small timeout)
 *   __MOCK_ECHO_MODEL__    → success envelope echoing the requested model in summary
 *   anything else          → __MOCK_OK__ behavior (default)
 */

import process from "node:process";

async function readStdin() {
  process.stdin.setEncoding("utf8");
  let buf = "";
  for await (const chunk of process.stdin) buf += chunk;
  return buf;
}

const stdin = await readStdin();
const envelope = JSON.parse(stdin);
const diff = String(envelope.diff ?? "");
const model = envelope.model ?? "sonnet";

const okReview = (summary = "Test review") => ({
  ok: true,
  review: {
    summary,
    findings: [{ category: "bug", severity: "minor", summary: "test finding" }],
    confidence: "low",
  },
  latency_ms: 123,
  cost_usd: 0.0,
});

if (diff.includes("__MOCK_SOFT_FAIL__")) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: "mock soft failure" })}\n`);
  process.exit(0);
} else if (diff.includes("__MOCK_BAD_JSON__")) {
  process.stdout.write("definitely not json\n");
  process.exit(0);
} else if (diff.includes("__MOCK_EMPTY__")) {
  process.exit(0);
} else if (diff.includes("__MOCK_NONZERO_EXIT__")) {
  process.stderr.write("mock crashed before writing\n");
  process.exit(2);
} else if (diff.includes("__MOCK_HANG__")) {
  // Block for longer than any reasonable Python test timeout. We don't
  // use `new Promise(() => {})` because Node 22 detects "unsettled
  // top-level await" and exits with code 13 before our subprocess
  // timeout fires. A long setTimeout keeps the event loop alive in a
  // way Node accepts.
  await new Promise((resolve) => setTimeout(resolve, 60_000));
} else if (diff.includes("__MOCK_ECHO_MODEL__")) {
  process.stdout.write(`${JSON.stringify(okReview(`echoed-model: ${model}`))}\n`);
  process.exit(0);
} else {
  process.stdout.write(`${JSON.stringify(okReview())}\n`);
  process.exit(0);
}
