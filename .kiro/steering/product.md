---
inclusion: always
---

# Product Context

**Read `AGENTS.md` at the repository root for the full project brief, stack, folder structure, and conventions.** This file complements AGENTS.md with Kiro-specific guidance.

## Product summary

An AI agent that reviews GitHub pull requests using code-aware retrieval (hybrid BM25 + vector + rerank) and tool use. Built as a portfolio project to demonstrate production-grade AI integration engineering for hiring conversations.

## Who uses it

- Primary: the author, demoing it to hiring managers
- Eventually: any developer who connects their GitHub repo

## What "done" looks like for Phase 1

A user can:
1. Open the deployed web app
2. Paste a PR diff into a form
3. See a structured review stream back in the UI
4. View past reviews in a list

No retrieval, no agent loop, no evals yet. Those come in Phases 2–4.

## Current focus

**Phase 1 — Foundations**. Scaffolding only:
- Monorepo setup (pnpm + Turborepo)
- Next.js 15 web app with streaming API route
- Drizzle + Supabase + pgvector configured (not yet used for retrieval)
- Python indexer project scaffolded (not yet functional)
- Logging and observability wired
- CI green

## Out of scope for this session

- Agent loop implementation (hand-written, later)
- Tool definitions (hand-written, later)
- Prompts beyond a placeholder system prompt
- Retrieval logic
- Eval harness

## Spec-driven workflow

When implementing a feature, prefer creating a spec in `.kiro/specs/` first. Specs follow Kiro's requirements → design → tasks flow. For Phase 1 scaffolding tasks, the checklist in `docs/architecture.md` section 10 acts as the master spec.

## Constraints summary

Full constraints in `AGENTS.md` § 7 ("Never do"). Highlights:

- Never modify `packages/agent/src/loop.ts`, `prompts/`, or `retrieval/` — those are hand-authored
- Never use `pip`, `npm`, `yarn` — use `uv` and `pnpm`
- Never edit published prompt versions in place — bump version
- Never commit secrets
