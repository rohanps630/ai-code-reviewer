#!/usr/bin/env node
/**
 * Eval-time agent bridge (Phase 4.6).
 *
 * Stdin/stdout glue between the Python eval runner and the TS agent.
 * The runner spawns this script per example, writes a JSON envelope
 * to stdin, and reads the agent's final ReviewOutput back from stdout.
 *
 * Wire format (stdin):
 *   { "diff": string, "model"?: "haiku"|"sonnet"|"opus",
 *     "repoContext"?: { "owner": string, "repo": string, "defaultBranch": string } }
 *
 * Wire format (stdout):
 *   { "ok": true, "review": ReviewOutput, "latency_ms": number, "cost_usd": number }
 *   OR
 *   { "ok": false, "error": string }
 *
 * Exit code: 0 on success (even if `ok: false`), 1 only on truly
 * catastrophic failure (malformed stdin / crashed before writing stdout).
 * The Python wrapper distinguishes the two by parsing stdout.
 *
 * Cost reporting:
 *   v1 always reports `cost_usd: 0.0`. The agent loop keeps cost as a
 *   local variable and doesn't surface it in any ReviewChunk; exposing
 *   it cleanly requires either (a) a new ReviewChunk variant or (b) a
 *   side channel on the loop's return. Both are protected-path changes
 *   and live with Phase 5 cost-telemetry work. The eval summary's
 *   `total_review_cost_usd` will be 0 until then; judge cost is
 *   tracked correctly through its own path.
 *
 * Requirements:
 *   - @acr/agent must be built (run `pnpm build:packages`).
 *   - ANTHROPIC_API_KEY + VOYAGE_API_KEY in env for real reviews; the
 *     CLI fails-loud if either is missing.
 */

import process from "node:process";

const STDIN_TIMEOUT_MS = 5_000; // Reading a small JSON envelope; shouldn't take longer.

async function main() {
  let envelope;
  try {
    envelope = await readStdinAsJson();
  } catch (err) {
    writeStderr(`agent-bridge: failed to parse stdin envelope: ${err?.message ?? err}`);
    process.exit(1);
  }

  if (typeof envelope.diff !== "string" || envelope.diff.length === 0) {
    writeStderr("agent-bridge: envelope.diff must be a non-empty string");
    process.exit(1);
  }
  const model = normalizeModel(envelope.model);
  if (model === null) {
    writeStderr(`agent-bridge: envelope.model must be 'haiku' | 'sonnet' | 'opus' or omitted`);
    process.exit(1);
  }

  const input = {
    diff: envelope.diff,
    model,
    repoContext: envelope.repoContext,
  };

  let agent;
  try {
    agent = await import("@acr/agent");
  } catch (err) {
    writeStdout({
      ok: false,
      error: `Cannot import @acr/agent. Did you run 'pnpm build:packages'? ${err?.message ?? err}`,
    });
    process.exit(0);
  }

  const startedAt = Date.now();
  let final = null;
  try {
    for await (const chunk of agent.runReview(input)) {
      if (chunk.type === "final") {
        final = chunk.output;
        // Don't break — let the loop finish cleanly so its own
        // termination logic + telemetry path runs.
      }
    }
  } catch (err) {
    writeStdout({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(0);
  }
  const latencyMs = Date.now() - startedAt;

  if (final === null) {
    writeStdout({
      ok: false,
      error: "agent-bridge: runReview completed without emitting a final ReviewChunk",
    });
    process.exit(0);
  }

  writeStdout({
    ok: true,
    review: final,
    latency_ms: latencyMs,
    cost_usd: 0.0, // see header comment — cost telemetry deferred to Phase 5
  });
  process.exit(0);
}

// ── helpers ──────────────────────────────────────────────────────────

function readStdinAsJson() {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(
      () => finish(reject, new Error(`stdin not closed within ${STDIN_TIMEOUT_MS}ms`)),
      STDIN_TIMEOUT_MS,
    );

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => {
      try {
        finish(resolve, JSON.parse(buffer));
      } catch (err) {
        finish(reject, err);
      }
    });
    process.stdin.on("error", (err) => finish(reject, err));
  });
}

function normalizeModel(model) {
  if (model === undefined || model === null) return "sonnet";
  if (model === "haiku" || model === "sonnet" || model === "opus") return model;
  return null;
}

function writeStdout(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function writeStderr(msg) {
  process.stderr.write(`${msg}\n`);
}

main().catch((err) => {
  writeStderr(`agent-bridge: uncaught error: ${err?.stack ?? err}`);
  process.exit(1);
});
