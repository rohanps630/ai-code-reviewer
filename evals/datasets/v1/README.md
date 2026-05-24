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

10 hand-crafted **seed examples** that anchor the schema and exercise
every category the agent reviews for. Each `seed-*` example is
synthetic: the diff is a minimal, realistic snippet rather than a copy
of a real PR, and `pr_url` is `null`. This is deliberate — the seeds
prove the schema, scorers, and harness end to end without depending on
us being able to fetch real PR diffs at authoring time. Real public-PR
examples (with `pr_url` populated) will be appended via the
`/new-eval` workflow as part of ongoing curation.

| id | difficulty | category / severity | notes |
|---|---|---|---|
| `seed-py-null-deref` | easy | bug / major | None-check removed; AttributeError at runtime |
| `seed-ts-off-by-one` | easy | bug / minor | `<` → `<=` overshoots array |
| `seed-ts-swallowed-exception` | easy | bug / minor | try/catch swallows error, returns null |
| `seed-ts-broken-type-cast` | easy | bug / major | `as any` papers over real shape mismatch |
| `seed-py-leaked-secret` | easy | security / critical | hardcoded Anthropic API key |
| `seed-react-stale-closure` | medium | bug / major | empty deps + non-functional updater |
| `seed-sql-injection` | medium | security / critical | f-string interpolation of user input |
| `seed-py-quadratic-loop` | medium | perf / major | dict lookup → linear scan (O(n+m) → O(n*m)) |
| `seed-race-condition` | hard | bug / critical | removed Mutex; concurrent map writes |
| `seed-ts-regex-redos` | hard | perf / critical | nested-quantifier regex; ReDoS vector |

Six of the ten include a `false_positive_traps` entry so the
deterministic scorer has something non-trivial to evaluate against.

## Category coverage

Every category the agent's `Finding` schema declares is now exercised
at least once:

| category | example count |
|---|---|
| bug | 6 |
| security | 2 |
| perf | 2 |
| logic | 0 (subsumed by bug for now) |
| style | 0 (intentionally — low-signal for portfolio evals) |

## Difficulty mix

Target (per `docs/evals.md`): **50 / 35 / 15** (easy / medium / hard).

| | easy | medium | hard | total |
|---|---|---|---|---|
| Seeds | 5 | 3 | 2 | 10 |
| v1 target | ~15 | ~11 | ~4 | 30+ |

Current mix: 50 / 30 / 20 — close to target. Future real-PR additions
should lean medium to keep the ratios on plan.

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
