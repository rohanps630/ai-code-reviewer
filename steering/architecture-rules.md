# Architecture Rules

These rules apply when modifying the structural boundaries, database schemas, or dependencies of the system.

## 1. Contracts Over Conventions
- Read existing contracts in `contracts/` before modifying boundaries.
- For example, if modifying the streaming logic, you MUST adhere to `contracts/event-stream.md`.

## 2. Component Boundaries
- `apps/web`: Next.js UI and API layer.
- `apps/indexer`: Python indexing pipeline and evaluation framework.
- `packages/agent`: Agent runtime, LLM tools, prompts.
- `packages/db`: Drizzle schemas and migrations.
- `packages/shared`: Cross-app types and Zod schemas.

## 3. Dependency Management
- Never use `pip` or `npm`.
- Use `uv` for Python (`apps/indexer`).
- Use `pnpm` for TypeScript/Node (`apps/web`, packages).

## 4. Architecture Discoverability
- Look in `architecture/components.json` and `knowledge/domain/` for the current structural overview and "Where to put new code".
- Do not introduce new architectural abstractions without explicitly proposing them in a design document or ADR first.
