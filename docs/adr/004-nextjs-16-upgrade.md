# ADR-004: Upgrade to Next.js 16

- **Status:** Accepted
- **Date:** 2025-06-05
- **Authors:** @rohanps630

## Context

The project was originally scaffolded on Next.js 15 (App Router, Server Components,
Server Actions). Next.js 16 shipped with breaking changes in how `params` and
`searchParams` are handled — they are now `Promise`-based in page components (see the
[Next.js 16 migration guide](https://nextjs.org/blog/next-16)).

Our codebase was already using the async `params` pattern in most pages, but a few page
components needed updates to `await` the params/searchParams props.

## Decision

Upgrade to Next.js 16 (currently `16.2.6`). Accept the breaking change to
`Promise<Params>` signatures and update all page components accordingly.

## Consequences

- **`params` and `searchParams`** in page/layout components are now typed as `Promise`
  and must be `await`-ed.
- React 19 remains the minimum React version (compatible with Next 16).
- `next build --webpack` is used instead of Turbopack for production builds (Turbopack
  is used for `next dev` only when available).
- The `docs/guidelines.md` § 3 version reference is updated from "Next.js 15" to
  "Next.js 16".
