# AI-Native Engineering Platform — Agent Entry Point

**The canonical entry point for all AI agents is [`steering/shared-rules.md`](./steering/shared-rules.md). Read it in full before making any changes.** 

This root file is a thin pointer so that every AI coding tool — whether it reads `AGENTS.md` natively or via a tool-specific shim — resolves to the same single source of truth for the steering hierarchy.

@steering/shared-rules.md

## The Steering Layer

The project utilizes a hierarchical steering system to manage context windows efficiently:

```
tool-specific shim  →  AGENTS.md (this file)  →  steering/shared-rules.md
```

From `shared-rules.md`, you will be directed to load additional context depending on your task (e.g., `architecture-rules.md` or `review-rules.md`).

## Agent Discovery
- Tools that read `AGENTS.md` natively (Codex, Amp, opencode, Zed, Windsurf, Roo, Junie, Antigravity, Copilot coding-agent) get this pointer and follow it to the steering layer.
- Tools with their own discovery file (Claude `CLAUDE.md`, Cursor, Kiro, Gemini, Copilot VS Code, Cline, Aider) point at this file. The full tool→file map is maintained in the legacy `docs/guidelines.md` § 9.

## Editing Rules
Agent routing logic and universal rules live in `steering/`. Hard constraints live in `standards/never-do.md`. Contracts live in `contracts/`. Do not edit this pointer file or tool-specific shims.
