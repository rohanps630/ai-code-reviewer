# Roadmap

> Six-phase build plan. Each phase shipped means a tangible improvement and a set of new skills hands-on. Phases can overlap at the edges, but don't skip ahead — each builds on the previous.

## Phase 1 — Foundations (~3–4 days)

Build the dumbest version: paste a diff, get a streamed structured review back. No retrieval, no agent loop yet.

**Skills learned**

- LLM API depth (messages, system prompts, SSE streaming, JSON schema outputs)
- Prompt engineering fundamentals (role, few-shot, output formatting)
- Token economics
- Vercel AI SDK vs raw fetch trade-offs

**Ship criteria**

- Web app deployed to Vercel
- `/api/reviews` endpoint accepts a diff and streams a placeholder structured review
- Reviews persist to Postgres
- Sentry + Langfuse wired
- CI green

## Phase 2 — RAG done right (~1 week)

Index a real codebase. Retrieve relevant context on each review.

**Skills learned**

- Embedding models (cost/quality/dimension trade-offs)
- AST-aware chunking with tree-sitter
- pgvector with HNSW
- Hybrid search (BM25 + vector + reranking)
- Contextual retrieval

**Ship criteria**

- Indexer can ingest a public OSS repo
- `searchCode(query)` returns relevant chunks with file/line metadata
- Review endpoint uses retrieved context (still static, no agent yet)
- Retrieval recall measured on a small fixture

## Phase 3 — Agents and tool use (~1 week)

Replace static retrieval with an agent loop. Model decides what to look up.

**Skills learned**

- Tool/function-calling API contracts
- Writing tool descriptions the model uses correctly
- ReAct-style loop implementation
- Failure modes (infinite loops, hallucinated tools, error recovery)
- Framework comparison (LangGraph, Anthropic Agent SDK)

**Ship criteria**

- Agent uses 4+ tools: `search_code`, `read_file`, `find_references`, `run_tests`
- Loop terminates correctly under all stop conditions
- UI shows tool calls as they happen
- One tool implemented inside an E2B sandbox

## Phase 4 — Evals (~4–5 days)

Build a golden dataset and a harness that scores the agent against it.

**Skills learned**

- Golden dataset construction
- LLM-as-judge design
- Deterministic scoring
- Tracking scores across changes

**Ship criteria**

- Dataset v1 with 30+ real PRs from public repos
- `evals.cli run` produces a summary.json with deltas vs prior run
- CI runs evals on PRs touching `packages/agent/`
- PR comment posts eval table automatically

## Phase 5 — Production concerns (~4–5 days)

Add tracing, caching, model routing, prompt-injection defense.

**Skills learned**

- Observability with proper tracing
- Prompt caching, semantic caching, exact cache
- Model routing for cost
- Prompt-injection defenses

**Ship criteria**

- Every LLM call traced in Langfuse with cost
- Three cache layers measured separately
- Model router picks haiku/sonnet/opus by PR signal
- Prompt-injection test suite passes

## Phase 6 (optional, archived) — Fine-tune a small model (~1 week)

> **Status: archived.** Phases 1–5 are complete. Phase 6 is deferred indefinitely — revisit if production logs accumulate enough signal to make a training dataset worthwhile.



Fine-tune a 7B model for a narrow sub-task.

**Skills learned**

- When fine-tuning beats prompting (usually it doesn't — that's the lesson)
- LoRA, QLoRA
- Building training datasets from production logs
- Distillation

**Ship criteria**

- Fine-tuned model deployed via vLLM or Fireworks
- Eval delta documented vs prompting the large model
- ADR written on whether to keep the fine-tuned model in production

## Phase 7 — GitHub-native review bot (proposed)

> **Status: proposed.** See `docs/adr/006-github-native-review-delivery.md` for the decision and
> the cut list (no SQLite layer, no self-push auto-commit). CI-first, daemon second.

Take reviews to where PRs live: inline GitHub review comments, first from CI, then from a
self-hostable daemon.

**Milestone 1 — CI mode (the category change)**

- New `packages/github`: PR diff fetcher, hunk-aware finding→line mapper, bulk review submitter
  (one grouped `POST .../reviews` call)
- `acr-review --pr <url>` CLI + GitHub Actions workflow using the ambient `GITHUB_TOKEN`
- Ship criteria: open a PR on a test repo → one grouped inline review appears, no hosting involved

**Milestone 2 — Suggestion blocks (prompt change — human-owned)**

- New prompt version teaching ` ```suggestion ` output for fixable findings
- Ship criteria: eval delta logged in `docs/prompts.md`; suggestions render with GitHub's
  "Commit suggestion" button

**Milestone 3 — Daemon mode**

- GitHub App auth (installation tokens), `/api/webhooks/github` with HMAC verify + fast ack,
  job queue/worker, Dockerfile + compose
- Incremental review on `synchronize` (only new commits) and per-PR cost caps
- Ship criteria: webhook-triggered review lands on a PR from a self-hosted container; pushing a
  new commit reviews only the delta

**Milestone 4 — Interactive PR chat**

- `issue_comment` command parsing (`/ask`, `/explain`), thread-context reconstruction into agent
  history
- Ship criteria: a reply in a review thread answers with full thread + codebase context

## Sequencing rules

- **Don't perfect each phase before moving on.** Get to Phase 4 (evals) fast — every later change needs evals to measure.
- **Write a blog post per phase.** Drafts in `docs/blog/`, published to your blog. Each post is recruiter bait.
- **Demo > docs.** A live URL beats a private repo.
- **Set spend limits on every provider on day one.**
