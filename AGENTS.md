# AI Code Reviewer — agent entry point

**The canonical project context is [`docs/guidelines.md`](./docs/guidelines.md). Read it in full
before making any changes.** This root file is a thin pointer so that every AI coding tool — whether
it reads `AGENTS.md` natively or via a tool-specific shim — resolves to the same single source of
truth.

`docs/` is the shared **agent-context hub**: all maintained guidance lives there as markdown.

@docs/guidelines.md

## The pointer chain

```
tool-specific shim  →  AGENTS.md (this file)  →  docs/guidelines.md (canonical)
```

- Tools that read `AGENTS.md` natively (Codex, Amp, opencode, Zed, Windsurf, Roo, Junie, Antigravity,
  Copilot coding-agent) get this pointer and follow it to `docs/guidelines.md`.
- Tools with their own discovery file (Claude `CLAUDE.md`, Cursor, Kiro, Gemini, Copilot VS Code,
  Cline, Aider) point at this file. The full tool→file map is in `docs/guidelines.md` § 9.

## The `docs/` hub

| File | What it holds |
|---|---|
| [`docs/guidelines.md`](./docs/guidelines.md) | **Canonical** — stack, structure, conventions, commit format, "never do" rules, single-source-of-truth policy |
| [`docs/architecture.md`](./docs/architecture.md) | Architecture, "where to put new code", version policy |
| [`docs/coding-style.md`](./docs/coding-style.md) | Coding style deep dive |
| [`docs/roadmap.md`](./docs/roadmap.md) | 6-phase build plan |
| [`docs/evals.md`](./docs/evals.md) · [`docs/prompts.md`](./docs/prompts.md) | Eval methodology · prompt change log |
| [`docs/adr/`](./docs/adr/) | Architecture decision records |

## Section references

Numbered section references elsewhere (e.g. "`AGENTS.md` § 7" in ADRs, slash commands, and docs) now
live in **`docs/guidelines.md`** under the **same numbering** — read `docs/guidelines.md` § N.

## Editing rule

Edit conventions, stack choices, "never do" rules, layout, and policy in **`docs/guidelines.md`** —
never in this pointer or in a tool-specific shim. To wire up a new agent, add its expected file as a
thin pointer to this `AGENTS.md` and record it in `docs/guidelines.md` § 9.
