# Agent & Retrieval Domain Knowledge

This document preserves the architectural domain knowledge regarding the AI Code Reviewer's core agent loops and retrieval pipelines.

## The Agent Package (`packages/agent`)

The agent package holds the core AI logic, which changes frequently and requires explicit human oversight.

**Key Principles:**
- **`Agent` is the runtime; `runReview` is a specialization** (ADR-005). The production loop lives in `agent.ts`: a declarative, model-agnostic class whose `stream()` drives a typed `AgentEvent` loop and owns cross-cutting concerns (cost accounting, aborts, timeouts, truncation, concurrency caps). `loop.ts` configures one `Agent` instance for code review.
- **Tools are pure-ish**: Inputs map to outputs via Zod schemas. Side effects (DB, HTTP) are dependency-injected for testing.
- **Explicit Termination**: The model must call `submit_review` (the stop tool) to terminate, or the run hits a hard cap/timeout.
- **Retrieval is composable**: `searchCode(query)` runs BM25 + vector + rerank as separate inspectable steps.

## Model Routing

A router picks the LLM based on the PR signal:
- **Trivial** (diff < 50 lines, single file, no API change) → `claude-haiku-4-5`
- **Standard** → `claude-sonnet-4-7`
- **Complex** (large diff, multiple files, public API changes) → `claude-opus-4-7`

*Note: Routing logic is rule-based in `packages/agent/src/loop.ts`. No ML classifier is used.*

## Retrieval Pipeline

For each review:
1. **Query construction**: Extract changed symbols from the diff; build queries per symbol + a general "what does this PR do" query.
2. **BM25 search**: Postgres full-text index.
3. **Vector search**: pgvector with HNSW.
4. **Merge + dedupe**: Reciprocal Rank Fusion (RRF).
5. **Rerank**: Top candidates reranked with Cohere `rerank-v3.5` (if key is set).
6. **Context**: Top results are provided to the agent.

## Indexing Pipeline (`apps/indexer`)

For each connected repo:
1. **Clone shallow** to a temp dir.
2. **Walk the file tree** with language detection.
3. **Chunk by AST** using tree-sitter.
4. **Generate contextual prefix** for each chunk via a small Claude call.
5. **Embed** with Voyage `voyage-code-3`.
6. **Upsert into Postgres** with HNSW index maintenance.

*Note: Reruns are incremental. Only changed files re-chunk and re-embed.*

## Caching Layers

1. **Exact-match**: Hash of full input, Upstash Redis, TTL 7d.
2. **Semantic**: Embedded query, cosine similarity > 0.95, Upstash Redis, TTL 1d.
3. **Prompt caching**: Anthropic's built-in feature on static prompt prefixes.
