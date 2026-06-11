# Operations & Security Domain Knowledge

This document preserves the architectural domain knowledge regarding deployments, observability, and security boundaries.

## Security Boundaries

- **Zod Validation**: All external input is validated through Zod before reaching agent logic.
- **API Guarding**: Routes are guarded by an access-key check (`x-access-key`) and per-IP rate limiting.
- **Untrusted Content**: Code retrieved from repos is treated as untrusted content. Prompt injection defenses are applied (delimiters + sanitization + instructional reminders).
- **Execution Sandbox**: E2B sandbox is used for any tool that executes code; nothing runs on the application servers.
- **Secret Scrubbing**: Langfuse and Sentry automatically scrub known environment variable names.
- **Database**: Analytics queries must use a read-only database user.

## Observability

- **Langfuse**: Traces every LLM call, tool span, full I/O, latency, and cost.
- **Sentry**: Captures exceptions in the web app and Python jobs.
- **Postgres**: Analytics via SQL on the `reviews` and `agent_events` tables.
- **Vercel Analytics**: Web app traffic and Core Web Vitals.

## Eval Harness

The Python evaluation pipeline (`apps/indexer/src/evals/`):
1. Loads dataset from `evals/datasets/`.
2. Runs the agent against the PR diff.
3. Scores with two judges:
   - LLM-as-judge (Claude Sonnet, rubric-based score 0-1).
   - Deterministic (did it find the known issue?).
4. Computes aggregates (latency, cost, P95).
5. Compares to prior runs to compute deltas.

## Deployment Topology

- **`apps/web`**: Vercel (auto-deploy on `main`).
- **`apps/indexer`**: Modal (cron-scheduled re-index + on-demand evals) - *Planned*.
- **Postgres**: Supabase (managed).
- **Cache**: Upstash Redis (serverless).
