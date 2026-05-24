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

5 hand-crafted **seed examples** that anchor the schema and exercise
every field. Each `seed-*` example is synthetic: the diff is a minimal,
realistic snippet rather than a copy of a real PR, and `pr_url` is
`null`. This is deliberate — the seeds prove the schema and runner end
to end without depending on us being able to fetch real PR diffs at
authoring time. Real public-PR examples (with `pr_url` populated) will
be appended via the `/new-eval` workflow in task 4.10.

| id | difficulty | category / severity | notes |
|---|---|---|---|
| `seed-py-null-deref` | easy | bug / major | None-check removed; AttributeError at runtime |
| `seed-ts-off-by-one` | easy | bug / minor | `<` → `<=` overshoots array |
| `seed-react-stale-closure` | medium | bug / major | Empty deps + non-functional updater |
| `seed-sql-injection` | medium | security / critical | f-string interpolation of user input |
| `seed-race-condition` | hard | bug / critical | Removed Mutex; concurrent map writes |

Three of the five include a `false_positive_traps` entry so the
deterministic scorer in 4.2 has something to score against.

## Difficulty mix

Target (per `docs/evals.md`): **50 / 35 / 15** (easy / medium / hard).

| | easy | medium | hard | total |
|---|---|---|---|---|
| Seeds | 2 | 2 | 1 | 5 |
| v1 target (4.10) | ~15 | ~11 | ~4 | 30+ |

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
