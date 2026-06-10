# 006 — GitHub-native review delivery, CI-first

**Status**: Proposed
**Date**: 2026-06-11
**Deciders**: Rohan P Suresh

## Context

The reviewer is production-ready as a web app, but ingestion is manual: a user pastes a diff into
the dashboard. Every competing tool (CodeRabbit, Qodo/PR-Agent, Ellipsis) reviews pull requests
*where they live* — as inline comments on GitHub. A competitive gap analysis (2026-06) identified
GitHub-native delivery as the single change that moves this project from "demo you paste diffs
into" to "review bot teams can adopt."

Forces at play:

- **Webhooks don't fit the current deploy target.** A review takes minutes; GitHub webhooks time
  out in ~10 s. The web app deploys to Vercel serverless, which cannot hold a multi-minute
  background job. Daemon mode therefore *requires* new infrastructure (container + worker/queue).
- **CI mode requires no infrastructure.** A GitHub Actions step gets the PR checkout and a
  built-in `GITHUB_TOKEN` that can post reviews — no GitHub App, no webhook server, no hosting.
- **`packages/agent` loop, prompts, and retrieval are protected** (`docs/guidelines.md` § 7).
  GitHub integration must be built as adapters *around* the agent, not changes to it. The one
  exception — teaching the agent to emit GitHub `suggestion` blocks — is a prompt change and goes
  through the prompt-versioning process (new version + eval delta).
- **Cost:** `pull_request.synchronize` fires on every push. Naively re-reviewing the full diff on
  each push multiplies token spend on active PRs.

## Decision

We deliver reviews natively to GitHub, **CI-first**:

1. **A new `packages/github` package** owns all GitHub I/O: PR diff fetching, hunk-aware mapping
   of agent findings to `path` + `line` + `side` on the head commit, and bulk submission of one
   grouped review via `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews`. Built on Octokit
   (new dependency), Zod-validated at the boundary, agent untouched.
2. **CI mode ships first.** A standalone CLI (`acr-review --pr <url>`) runs the existing agent
   against a PR and posts the review using the ambient `GITHUB_TOKEN`. Distributed as a GitHub
   Actions workflow. This is the first public deliverable.
3. **Daemon mode ships second**, and only with its prerequisites: GitHub App auth (App ID +
   private key + installation tokens), `/api/webhooks/github` with `X-Hub-Signature-256` HMAC
   verification and fast 202 acknowledgement, a job queue/worker, and single-container Docker
   packaging. Incremental review (only commits since the last reviewed SHA) and per-PR cost caps
   are part of this milestone, not afterthoughts.
4. **Suggested fixes use GitHub's native ` ```suggestion ` blocks**, giving authors the built-in
   "Commit suggestion" button. This needs a new prompt version (per § 6 prompt policy) with a
   measured eval delta.

Explicitly **not** doing:

- **No dual-database abstraction (SQLite/sqlite-vec).** CLI/CI runs are ephemeral and operate on
  a local checkout; they need no database. The retrieval layer becomes *optional* for ephemeral
  runs instead of portable across dialects. Postgres + pgvector remains the only database.
- **No self-push auto-commit (`/commit` listener).** Suggestion blocks cover the use case;
  pushing to PR branches breaks on forks and adds permission risk for marginal value.

## Consequences

### Positive

- CI mode is adoptable with zero hosting — copy a workflow file, done.
- The agent core stays untouched; integration risk is isolated in `packages/github`.
- Cutting the SQLite layer and auto-commit removes the two highest-cost/lowest-value items.
- Cost guardrails (incremental review, caps) are designed in before public exposure.

### Negative

- Daemon mode (instant webhook-triggered reviews) arrives later than a webhook-first plan.
- No fully-offline single-binary story; self-hosters who want persistence must run Postgres.
- Octokit becomes a runtime dependency of the new package.

### Neutral

- The web dashboard remains the observability surface; GitHub becomes the delivery surface.
- Interactive PR chat (`/ask` commands, thread context) is deferred to a later milestone on the
  daemon-mode foundation.

## Alternatives considered

### Alternative A: Webhook/daemon mode first

What the gap analysis implied. Rejected as the first step: it front-loads GitHub App setup,
HMAC, queueing, and Docker before the first inline review ever appears, and it cannot run on the
current Vercel deployment at all.

### Alternative B: Dual-database layer (Postgres + SQLite) for self-hosting

Rejected: Drizzle across pgvector-HNSW and sqlite-vec means divergent index semantics, duplicated
migrations, and a second dialect to test — to serve ephemeral runs that work fine with no
database. PR-Agent, the closest open-source comparable, ships with no database.

### Alternative C: Auto-commit via the Git database API

Rejected in favor of suggestion blocks: GitHub already provides one-click commit for
` ```suggestion ` ranges, works on forks, and requires no write access to contributor branches.

## References

- Competitive gap analysis vs CodeRabbit / Qodo / PR-Agent / Ellipsis (2026-06, session notes)
- `docs/roadmap.md` Phase 7
- GitHub REST: Pulls — create a review (grouped comments, `line`/`side` addressing)
- ADR 003 — pluggable agent providers (Ollama/Groq already supported; unaffected here)
