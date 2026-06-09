# Dataset v1

Golden eval dataset for the AI code reviewer.

Schema and validation: `apps/indexer/src/evals/schema.py`
(load with `evals.schema.load_examples_jsonl`).

## What's in here

`examples.jsonl` — one `EvalExample` per line. Each example carries a
PR title + unified diff, the ground-truth finding(s) the agent should
flag, optional false-positive traps, a difficulty rating, and curation
metadata.

## Current contents

30 synthetic seed examples covering every category and difficulty the
agent reviews for. Each `seed-*` example uses a minimal realistic diff
and `pr_url: null`. Real public-PR examples (with `pr_url` populated)
can be appended via the `/new-eval` workflow as ongoing curation.

| id | difficulty | category / severity | notes |
|---|---|---|---|
| `seed-py-null-deref` | easy | bug / major | None-check removed; AttributeError at runtime |
| `seed-ts-off-by-one` | easy | bug / minor | `<` → `<=` overshoots array |
| `seed-ts-swallowed-exception` | easy | bug / minor | try/catch swallows error, returns null |
| `seed-ts-broken-type-cast` | easy | bug / major | `as any` papers over real shape mismatch |
| `seed-py-leaked-secret` | easy | security / critical | hardcoded Anthropic API key |
| `seed-py-mutable-default` | easy | bug / major | mutable default arg shared across calls |
| `seed-ts-no-await` | easy | bug / major | missing await; write fires-and-forgets |
| `seed-py-file-not-closed` | easy | bug / minor | file handle leaks on exception path |
| `seed-ts-optional-chain` | easy | bug / major | missing `?.` causes TypeError on null |
| `seed-py-hardcoded-creds` | easy | security / critical | hardcoded DB password in source |
| `seed-ts-nan-check` | easy | bug / minor | `=== NaN` always false; NaN passes check |
| `seed-py-bare-except` | easy | bug / minor | bare except masks KeyboardInterrupt |
| `seed-ts-state-mutation` | easy | bug / major | React state array mutated in place |
| `seed-go-unchecked-error` | easy | bug / major | os.WriteFile error silently discarded |
| `seed-py-int-conversion` | easy | logic / minor | unguarded int() raises 500 on bad input |
| `seed-react-stale-closure` | medium | bug / major | empty deps + non-functional updater |
| `seed-sql-injection` | medium | security / critical | f-string interpolation of user input |
| `seed-py-quadratic-loop` | medium | perf / major | dict lookup → linear scan (O(n+m) → O(n*m)) |
| `seed-ts-missing-cleanup` | medium | perf / major | resize listener never removed; leaks |
| `seed-py-timing-attack` | medium | security / major | `==` on tokens enables timing attacks |
| `seed-ts-n-plus-one` | medium | perf / major | N+1 DB query inside async loop |
| `seed-py-xml-injection` | medium | security / major | stdlib XML vulnerable to XXE |
| `seed-go-goroutine-leak` | medium | perf / major | ctx.Done removed; goroutine leaks |
| `seed-ts-csrf-get` | medium | security / major | state change on GET endpoint; CSRF-able |
| `seed-py-reentrant-lock` | medium | bug / critical | Lock → RLock downgrade causes deadlock |
| `seed-ts-stale-cache` | medium | logic / major | cache TTL removed; stale config forever |
| `seed-race-condition` | hard | bug / critical | removed Mutex; concurrent map writes |
| `seed-ts-regex-redos` | hard | perf / critical | nested-quantifier regex; ReDoS vector |
| `seed-ts-toctou` | hard | security / critical | access()+write() TOCTOU race on uploads |
| `seed-py-float-accumulation` | hard | bug / major | float accumulation in financial ledger |

## Category coverage

| category | example count |
|---|---|
| bug | 17 |
| security | 7 |
| perf | 5 |
| logic | 1 |
| style | 0 (intentionally — low-signal for portfolio evals) |

## Difficulty mix

Target (per `docs/evals.md`): **50 / 35 / 15** (easy / medium / hard).

| | easy | medium | hard | total |
|---|---|---|---|---|
| Current | 15 | 11 | 4 | **30** |
| Target | ~15 | ~11 | ~4 | 30+ |

Mix: **50 / 37 / 13** — on target.

## Immutability

Once a dataset version is published, its examples are immutable.
Adding new examples to v1 is fine; **editing or removing existing
ones is not** — bump to `v2/` instead. Historical eval-run summaries
are keyed to the dataset version they ran against.

## Adding examples

Use `/new-eval <pr-url>` (Claude Code command) or append a JSON line
manually. Each new line must validate against `EvalExample`. The unit
test at `apps/indexer/tests/test_evals_schema.py::test_dataset_v1_loads`
fails the build if the file stops parsing.
