# retrieval-v0 — Phase 2.8 smoke benchmark

Tiny hand-crafted fixture (8 docs / 11 chunks / 8 queries) for the
retrieval recall benchmark. Chunks model a small auth + billing
service so every query has obvious correct answers.

## What it measures

`recall@k` against the `expected_chunk_ids` per query. A query
"passes" if any of its expected chunks lands in the top-k.

This is a **smoke** benchmark — it proves the retrieval orchestration
works end-to-end against real Postgres + pgvector. It does **not**
measure semantic quality with real embeddings; the benchmark uses
deterministic synthetic vectors derived from chunk content so the
run is reproducible and free. The Phase 4 eval harness will plug in
real Voyage + larger fixtures and report semantic metrics.

## Running it

```bash
# Requires a Postgres URL with pgvector enabled. The script truncates
# repos/documents/chunks for the fixture repo each run; don't point it
# at a production database.
DATABASE_URL=postgresql://... pnpm bench:retrieval
```

Outputs a `summary.json` to `evals/results/retrieval-v0-<timestamp>/`.

## Schema of fixture.json

```jsonc
{
  "name": "retrieval-v0",
  "repo": { "url", "owner", "name", "default_branch" },
  "documents": [{ "id", "path", "language" }],
  "chunks": [{
    "id",                    // stable id used as expected_chunk_ids
    "document_id",
    "chunk_index",
    "start_line", "end_line",
    "symbol_name", "symbol_kind",
    "content",               // what gets BM25-indexed
    "context"                // prepended to content for embedding
  }],
  "queries": [{ "id", "query", "expected_chunk_ids": [] }]
}
```

## Updating the fixture

- Keep it small — additions cost reproducibility, not retrieval quality.
- Each new query must have at least one `expected_chunk_id` that
  exists in `chunks[].id`.
- Update the version in the JSON when changing chunk content or query
  expectations so historical `summary.json` runs stay comparable.
