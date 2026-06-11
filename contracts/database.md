# Database Contract

This contract defines the structural guarantees and boundaries of the shared Postgres database. Both the `apps/web` (Next.js) and `apps/indexer` (Python) applications rely on this shared state.

## 1. Single Source of Truth
- The schema is exclusively defined and owned by `packages/db` via Drizzle ORM.
- **Python Constraints**: The Python worker (`apps/indexer`) must never perform schema migrations. It must assume the schema is already initialized and correct. It interacts with the database via raw SQL or SQLAlchemy models that strictly mirror the Drizzle definitions.

## 2. Table Guarantees

### `reviews`
- **Ownership**: Created by `apps/web` when a PR diff is submitted.
- **Contract**: Contains run-level metadata. The `cache_status` and `prompt_cache_tokens` must be updated accurately by the Agent runtime upon completion.

### `agent_events`
- **Ownership**: Written exclusively by the `Agent` event stream tee (`use-review-stream.ts` / API route).
- **Contract**: Must maintain strict sequential (`seq`) ordering per `review_id` to guarantee identical UI replayability.

### `chunks` and `documents`
- **Ownership**: Written exclusively by `apps/indexer`.
- **Contract**: The `apps/web` application must treat these tables as **Read-Only**. They contain the AST-aware chunks, Voyage vector embeddings (`pgvector`), and BM25 text indices.

### `semantic_cache`
- **Ownership**: Written and read by the Agent retrieval pipeline.
- **Contract**: Exists for similarity matching. Records must be considered ephemeral and can be truncated or aged out without impacting core application logic.

## 3. Migration Rules
- Any change to the database schema must be executed via `pnpm db:migrate` from `packages/db`.
- Removing columns or changing types of active tables is considered a breaking change across application boundaries and requires coordination with both the TS and Python codebases.
