#!/usr/bin/env node
/**
 * Retrieval recall smoke benchmark (Phase 2.8).
 *
 * What it does:
 *   1. Connects to Postgres (DATABASE_URL).
 *   2. Truncates the fixture repo's rows in chunks/documents/repos.
 *   3. Loads `evals/retrieval-v0/fixture.json` into Postgres, generating
 *      deterministic synthetic 1024-dim embeddings from chunk content
 *      hashes.
 *   4. For each query, runs the hybrid retriever (BM25 + vector + RRF)
 *      and computes whether any expected chunk lands in top-k.
 *   5. Writes a `summary.json` to evals/results/retrieval-v0-<timestamp>/.
 *
 * Why synthetic vectors:
 *   The point of v0 is to prove the SQL + orchestration works against
 *   a real pgvector instance without spending Voyage tokens on every
 *   CI run. The deterministic hash-derived vectors give the vector lane
 *   real, non-empty results to play with — RRF behavior is exercised —
 *   while keeping the benchmark reproducible. Phase 4 will plug in real
 *   embeddings.
 *
 * Requirements:
 *   - DATABASE_URL pointing at a Postgres with pgvector
 *   - The schema in packages/db/src/migrations must already be applied
 *   - @acr/agent and @acr/db must be built (run `pnpm build:packages`)
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm bench:retrieval
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process, { stdout } from "node:process";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURE_PATH = path.join(REPO_ROOT, "evals/retrieval-v0/fixture.json");
const RESULTS_ROOT = path.join(REPO_ROOT, "evals/results");

const K_VALUES = [1, 3, 5, 10];

// ────────────────────────────────────────────────────────────────────
// Logging
// ────────────────────────────────────────────────────────────────────

const COLOR_OK = Boolean(stdout.isTTY) && process.env.NO_COLOR !== "1";
const c = (open, close) => (s) => (COLOR_OK ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
const dim = c(2, 22);
const red = c(31, 39);
const green = c(32, 39);
const yellow = c(33, 39);
const cyan = c(36, 39);

function log(msg) {
  console.log(msg);
}

function fail(msg) {
  console.error(red(`✗ ${msg}`));
  process.exit(1);
}

// ────────────────────────────────────────────────────────────────────
// Deterministic synthetic embedder
// ────────────────────────────────────────────────────────────────────

const EMBED_DIM = 1024;

/** Turn arbitrary text into a deterministic 1024-dim unit vector.
 *  Not semantic, but stable across runs — same input always yields the
 *  same vector. Good enough to exercise pgvector's HNSW + cosine ops. */
function deterministicVector(text) {
  // Use sha256 of the input as a seed, then expand into EMBED_DIM
  // floats by hashing repeatedly. We center on 0.0 so vectors aren't
  // all in the positive orthant (which would collapse cosine angles).
  const out = new Array(EMBED_DIM).fill(0);
  let chunkIdx = 0;
  while (chunkIdx * 8 < EMBED_DIM) {
    const seed = `${text}::${chunkIdx}`;
    const hash = createHash("sha256").update(seed).digest();
    for (let i = 0; i < 8 && chunkIdx * 8 + i < EMBED_DIM; i++) {
      const slot = chunkIdx * 8 + i;
      // 4 bytes → uint32 → normalize to [-1, 1]
      const u32 = hash.readUInt32BE(i * 4);
      out[slot] = (u32 / 0xffffffff) * 2 - 1;
    }
    chunkIdx++;
  }
  // Normalize to unit length so cosine distance behaves sensibly.
  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

class DeterministicEmbedder {
  async embedQuery(query) {
    return deterministicVector(query);
  }
}

// ────────────────────────────────────────────────────────────────────
// Postgres helpers
// ────────────────────────────────────────────────────────────────────

async function importDbAndAgent() {
  // Dynamic import: these are workspace packages that must be built
  // (tsc --build) for the script to resolve their dist/ entry points.
  let agent;
  let dbClient;
  try {
    agent = await import("@acr/agent");
  } catch (err) {
    fail(
      `Cannot import @acr/agent. Did you run 'pnpm build:packages'? Underlying error: ${err?.message ?? err}`,
    );
  }
  try {
    dbClient = await import("@acr/db/client");
  } catch (err) {
    fail(`Cannot import @acr/db/client: ${err?.message ?? err}`);
  }
  return { agent, db: dbClient.db };
}

function vectorLiteral(vec) {
  return `[${vec.join(",")}]`;
}

async function loadFixtureIntoPostgres(db, fixture) {
  log(dim("→ Truncating fixture repo data..."));
  // We don't have a repo id yet, so we delete by url match. Cascade
  // takes documents + chunks with it.
  await db.execute(/* sql */ `delete from repos where url = '${fixture.repo.url}'`);

  log(
    dim(
      `→ Inserting repo + ${fixture.documents.length} documents + ${fixture.chunks.length} chunks...`,
    ),
  );

  const [repoRow] = await db.execute(/* sql */ `
    insert into repos (url, owner, name, default_branch, status)
    values (
      '${fixture.repo.url}',
      '${fixture.repo.owner}',
      '${fixture.repo.name}',
      '${fixture.repo.default_branch}',
      'indexed'
    )
    returning id
  `);
  const repoId = repoRow.id;

  const documentIdByFixtureId = new Map();
  for (const doc of fixture.documents) {
    const fakeHash = createHash("sha256").update(`fixture::${doc.id}`).digest("hex");
    const [row] = await db.execute(/* sql */ `
      insert into documents (repo_id, path, language, content_hash, size_bytes)
      values (
        '${repoId}'::uuid,
        '${doc.path}',
        '${doc.language}',
        '${fakeHash}',
        ${1000}
      )
      returning id
    `);
    documentIdByFixtureId.set(doc.id, row.id);
  }

  const chunkIdByFixtureId = new Map();
  for (const chunk of fixture.chunks) {
    const docId = documentIdByFixtureId.get(chunk.document_id);
    if (!docId) fail(`chunk ${chunk.id} references missing document ${chunk.document_id}`);

    const contentWithContext = `${chunk.context}\n\n${chunk.content}`;
    const vec = deterministicVector(contentWithContext);
    const contentHash = createHash("sha256").update(chunk.content).digest("hex");

    // postgres-js parameterizes via tagged templates; the dynamic
    // `db.execute` we use takes a raw SQL string, so we escape values
    // by replacing quotes. Inputs are fixture-controlled, not user data.
    const safeContent = chunk.content.replace(/'/g, "''");
    const safeContentCtx = contentWithContext.replace(/'/g, "''");
    const safeSymbol = (chunk.symbol_name ?? "").replace(/'/g, "''");
    const safeKind = chunk.symbol_kind ?? null;

    const [row] = await db.execute(/* sql */ `
      insert into chunks (
        document_id, repo_id, chunk_index, start_line, end_line,
        content, content_with_context, symbol_name, symbol_kind,
        content_hash, embedding
      )
      values (
        '${docId}'::uuid,
        '${repoId}'::uuid,
        ${chunk.chunk_index},
        ${chunk.start_line},
        ${chunk.end_line},
        '${safeContent}',
        '${safeContentCtx}',
        ${safeSymbol ? `'${safeSymbol}'` : "null"},
        ${safeKind ? `'${safeKind}'` : "null"},
        '${contentHash}',
        '${vectorLiteral(vec)}'::vector
      )
      returning id
    `);
    chunkIdByFixtureId.set(chunk.id, row.id);
  }

  log(green("✓ Fixture loaded."));
  return { repoId, chunkIdByFixtureId };
}

// ────────────────────────────────────────────────────────────────────
// Benchmark
// ────────────────────────────────────────────────────────────────────

function recallAtK(rankedIds, expectedIds, k) {
  const topK = new Set(rankedIds.slice(0, k));
  for (const expected of expectedIds) {
    if (topK.has(expected)) return 1;
  }
  return 0;
}

async function runBenchmark() {
  if (!process.env.DATABASE_URL) {
    fail("DATABASE_URL is not set. See evals/retrieval-v0/README.md.");
  }

  log(cyan("Retrieval recall benchmark — retrieval-v0"));
  log(dim(`Repo root:   ${REPO_ROOT}`));
  log(dim(`Fixture:     ${path.relative(REPO_ROOT, FIXTURE_PATH)}`));
  log("");

  const fixtureRaw = await readFile(FIXTURE_PATH, "utf8");
  const fixture = JSON.parse(fixtureRaw);

  const { agent, db } = await importDbAndAgent();

  const { repoId, chunkIdByFixtureId } = await loadFixtureIntoPostgres(db, fixture);

  const retriever = new agent.HybridRetriever({
    embedder: new DeterministicEmbedder(),
    executor: db,
    // No reranker — keeps the bench free + reproducible.
  });

  const expectedDbIdsFor = (fixtureChunkIds) =>
    fixtureChunkIds.map((fid) => chunkIdByFixtureId.get(fid)).filter(Boolean);

  log(`\n${cyan("Running queries...")}`);
  const perQuery = [];
  for (const q of fixture.queries) {
    const start = Date.now();
    const results = await retriever.search(q.query, { repoId, limit: Math.max(...K_VALUES) });
    const elapsedMs = Date.now() - start;

    const rankedIds = results.map((r) => r.chunkId);
    const expectedIds = expectedDbIdsFor(q.expected_chunk_ids);

    const recall = {};
    for (const k of K_VALUES) recall[`recall@${k}`] = recallAtK(rankedIds, expectedIds, k);

    const ok = recall[`recall@${Math.max(...K_VALUES)}`] === 1;
    log(
      `  ${ok ? green("✓") : red("✗")} ${q.id}  ${dim(`(${elapsedMs}ms)  `)}r@1=${recall["recall@1"]} r@3=${recall["recall@3"]} r@5=${recall["recall@5"]} r@10=${recall["recall@10"]}  ${dim(q.query)}`,
    );
    perQuery.push({
      query_id: q.id,
      query: q.query,
      expected_chunk_fixture_ids: q.expected_chunk_ids,
      ranked_chunk_ids: rankedIds,
      ...recall,
      latency_ms: elapsedMs,
    });
  }

  const aggregate = {};
  for (const k of K_VALUES) {
    const sum = perQuery.reduce((acc, r) => acc + r[`recall@${k}`], 0);
    aggregate[`mean_recall@${k}`] = sum / perQuery.length;
  }
  aggregate.median_latency_ms = median(perQuery.map((r) => r.latency_ms));
  aggregate.p95_latency_ms = percentile(
    perQuery.map((r) => r.latency_ms),
    0.95,
  );

  log("");
  log(cyan("Aggregate"));
  for (const k of K_VALUES) {
    const v = aggregate[`mean_recall@${k}`];
    log(`  mean recall@${k}  ${(v * 100).toFixed(1)}%`);
  }
  log(`  p50 latency      ${aggregate.median_latency_ms}ms`);
  log(`  p95 latency      ${aggregate.p95_latency_ms}ms`);

  // Write summary.json
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(RESULTS_ROOT, `retrieval-v0-${timestamp}`);
  await mkdir(outDir, { recursive: true });

  const summary = {
    benchmark: "retrieval-v0",
    fixture_version: fixture.version,
    timestamp: new Date().toISOString(),
    runner: "scripts/retrieval-bench.mjs",
    embedder: "deterministic-sha256-1024",
    reranker: null,
    queries: perQuery.length,
    aggregate,
    per_query: perQuery,
  };
  const summaryPath = path.join(outDir, "summary.json");
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  log(yellow(`\nSummary written: ${path.relative(REPO_ROOT, summaryPath)}`));

  // Best-effort connection close
  try {
    await db.$client?.end?.();
  } catch {
    /* ignore */
  }
}

function median(xs) {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(xs, p) {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

try {
  await runBenchmark();
} catch (err) {
  fail(err?.stack ?? String(err));
}
