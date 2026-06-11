# 002 — TypeScript project references for cross-package imports

**Status**: Accepted
**Date**: 2026-05-14
**Deciders**: Project author

## Context

Phase 1 set up four TypeScript workspaces: `packages/shared`, `packages/db`,
`packages/agent`, and `apps/web`. Each was wired with its own `tsconfig.json`
extending the root `tsconfig.base.json` (which sets `noEmit: true` and
`moduleResolution: "Bundler"`). Every package's `package.json` exports field
points the `default` and `types` conditions directly at the TypeScript source
under `./src/`. Cross-package imports work in dev only because Vitest's TS
loader and Next.js's `transpilePackages` shoulder the transpilation.

This setup hit two concrete problems during Phase 1, and a third was forecast:

1. **rootDir conflict** (HANDOFF § 9.5). Importing `@acr/shared/env` from
   `packages/db/src/client.ts` was rejected by `tsc` because the imported
   module sits outside `@acr/db`'s declared `rootDir: src`. The Phase 1
   workaround was to read `process.env.DATABASE_URL` directly in the DB
   client, duplicating env access logic that already lives in `@acr/shared`.

2. **Webpack `.js` extension resolution** (Task 7). The packages' TS source
   uses NodeNext-style `.js` specifiers (`import { foo } from "./bar.js"`).
   That's the correct ESM style and the only one TypeScript's
   `"moduleResolution": "NodeNext"` mode emits. But Next 16's webpack can't
   resolve `./bar.js` to a real `./bar.ts` source file without help, so
   `apps/web/next.config.ts` carries an `extensionAlias` mapping
   `.js → [.ts, .tsx, .js]` and a `transpilePackages: ["@acr/agent",
   "@acr/db", "@acr/shared"]` declaration. Both are workarounds against a
   structural problem.

3. **Phase 3 expansion**. The agent package will start importing from
   `@acr/shared` (for the `Result` type and review status enums) and
   `@acr/db` (for retrieval queries). Adding more cross-package imports
   compounds (1) and (2) until they become blockers.

The user's pre-existing `TODO` at the repo root committed to fixing this
before Phase 2 starts, with an ADR documenting the decision.

## Decision

Convert all TypeScript workspaces to **TypeScript project references**
with `composite: true`, real emit to `dist/`, and `package.json` `exports`
pointing at the compiled artifacts.

Concretely:

1. Each package (`@acr/shared`, `@acr/db`, `@acr/agent`) gets:
   - `composite: true`, `declaration: true`, `declarationMap: true`,
     `sourceMap: true`, `noEmit: false` in its `tsconfig.json`.
   - `outDir: dist`, `rootDir: src`, and an `exclude` that drops test
     files from the build output.
   - A `build` script: `tsc --build`.
   - A `clean` script: `rm -rf dist tsconfig.tsbuildinfo`.
   - `package.json` `exports` rewritten to point at `./dist/*.js` for
     `default` and `./dist/*.d.ts` for `types`.

2. Each package's `tsconfig.json` declares its upstream dependencies via
   a `references` array. Concretely:
   - `@acr/shared`: no references.
   - `@acr/db`: references `@acr/shared`.
   - `@acr/agent`: no references at Phase 1; will grow as Phase 2/3
     introduce real imports.
   - `apps/web`: references all three.

3. The repo root gains a `tsconfig.json` (separate from
   `tsconfig.base.json`) listing every package as a reference, so
   `tsc --build` from root walks the dependency graph and builds in
   the right order.

4. `tsconfig.base.json` drops `noEmit: true` (it was preventing emit
   even where we wanted it; individual packages can still opt-in to
   `noEmit` for typecheck-only scripts).

5. `apps/web/next.config.ts` drops the `extensionAlias` workaround and
   the `transpilePackages` entry — Next now sees real compiled `.js`
   from `dist/`.

6. `packages/db/src/client.ts` switches to importing `serverEnv` from
   `@acr/shared/env`, deleting the duplicate `process.env.DATABASE_URL`
   read.

7. Root scripts: a new `pnpm build:packages` runs `tsc --build`. CI
   runs it before `typecheck` / `test` / `build`. Turbo's existing
   `^build` dependency in the `test` task already enforces this in
   the workspace-graph ordering once each package has a `build`
   script.

## Consequences

### Positive

- ✅ Single source of truth for env access; `@acr/db` consumes
  `@acr/shared/env` properly.
- ✅ No more webpack `extensionAlias` workaround. The dist contains real
  `.js` files, so `./loop.js` resolves the way every Node ESM resolver
  expects.
- ✅ No more `transpilePackages` for the workspace packages. Faster
  Next builds because the packages are pre-compiled.
- ✅ `tsc --build` produces incremental builds across the whole graph.
  Touching one file in `@acr/shared` only rebuilds shared + its
  downstream packages, not the world.
- ✅ Real `.d.ts` files with sourcemaps. Editor jump-to-definition
  still lands on the original `.ts` because of `declarationMap`.
- ✅ Production-credible setup. Anyone reviewing this repo recognizes
  the canonical TS monorepo shape.

### Negative

- ⚠️ Cold-boot requires `pnpm build:packages` before `pnpm dev` works.
  Devs editing only `apps/web` won't notice; devs editing a package
  need to rebuild it (or run `tsc --build --watch` alongside).
- ⚠️ Vitest in each package and route tests in `apps/web` resolve
  cross-package imports through the package's `dist`, so the dist
  must be fresh before tests pass. Turbo handles this via `^build`
  in the task graph; humans running a single test by hand might be
  surprised.
- ⚠️ `dist/` directories add ~tens of MB to the working tree but are
  gitignored.

### Neutral

- ➖ Each package now has a `build` script. Turbo caches it.
- ➖ Source files under `src/**/*.test.ts` are excluded from the
  emitted dist so test code doesn't ship into the runtime artifact.

## Alternatives considered

### Alternative A: Keep src-pointing exports + composite + `emitDeclarationOnly`

Use project references purely for type-checking organization, keep
the `default` export pointing at `./src/*.ts`, emit only `.d.ts` to
`dist/`.

Rejected. Solves the rootDir conflict but leaves the webpack
`extensionAlias` workaround in place, because the runtime is still
reading TS source through bundler transpilation. Half a fix.

### Alternative B: Drop `.js` specifiers from package source

Edit every `import { x } from "./y.js"` in the packages to remove
the `.js` extension and rely on `moduleResolution: "Bundler"`
everywhere.

Rejected. `packages/agent/src/` is protected (AGENTS.md § 7), so we
can't blanket-rewrite imports there. Also, the `.js` style is the
correct ESM-NodeNext form and would have to come back the day we
ship the package outside a bundler.

### Alternative C: Conditional `exports` with a `"development"` condition

Point `exports` at `./src` under the `"development"` condition and at
`./dist` under `"default"`. Bundlers honor `"development"` when
`NODE_ENV=development`; production builds resolve to dist.

Rejected for Phase 2 prep specifically — the conditional adds a
moving part for a problem we don't have yet (slow dev rebuilds
across packages aren't a bottleneck for our small graph). Worth
revisiting if rebuilds become painful.

### Alternative D: Leave it as-is, paper over with `transpilePackages`

The status quo. Cheap but doesn't survive a Phase 3 expansion where
multiple packages cross-import freely. The TODO existed precisely
because deferring further would cost more than fixing now.

## References

- [TypeScript handbook — Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [Anthropic — Monorepo TS patterns blog](https://www.totaltypescript.com/typescript-project-references)
- [Vercel — Turborepo + TS project references guide](https://turbo.build/repo/docs/guides/tools/typescript)
- HANDOFF.md § 9.5 (the rootDir conflict that motivated the TODO)
