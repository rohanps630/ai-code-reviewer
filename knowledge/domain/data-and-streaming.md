# Data & Streaming Domain Knowledge

This document preserves the architectural domain knowledge regarding data models and event streaming.

## Data Model

Schemas live in `packages/db/src/schema/`. 
*Note: Constraints and guarantees for these tables are formally defined in `contracts/database.md`.*

**Active Tables:**
- `reviews`: One row per review request (diff, output JSONB, status, tokens, cost, cache status).
- `repos`: Connected GitHub repositories.
- `documents`: Files in indexed repos.
- `chunks`: AST-aware chunks with vector embeddings and BM25 text indices.
- `semantic_cache`: Cached responses by query embedding.
- `agent_events`: The persisted review event stream for run/step replay.

**Planned:**
- `eval_*` tables for DB-backed evaluation stores.

## Streaming Architecture

**Inside the Agent Loop:**
- The `Agent` runtime's `stream()` emits a typed `AgentEvent` sequence.
- `runReview` maps this to a `ReviewChunk` stream.
- Tool calls stream their state progressively (e.g., "Searching code…").

**Transport & Persistence:**
- The transport is newline-delimited JSON (NDJSON) over a streamed HTTP response (`/api/reviews`). It explicitly does not use the Vercel AI SDK or WebSockets.
- The client parses chunks line-by-line.
- As the stream runs, `review-stream.ts` tees each `ReviewChunk` into the `agent_events` table.
- **Replay Invariant**: The review detail page reconstructs the run identically using the shared `review-stream-state.ts` reducer.

*Note: The structural guarantees of the event stream are defined in `contracts/event-stream.md`.*
