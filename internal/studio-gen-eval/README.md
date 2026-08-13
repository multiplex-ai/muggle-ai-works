# studio-gen-eval

Internal CLI that measures how reliably the studio generates a working script
from a test case: it runs cloud generation N times per case and reports a
self-reported pass-rate plus a failure-mode breakdown. Design rationale lives in
the brain (`architecture/2026-06-24-studio-gen-eval-design.md`); this README is
the concrete surface.

## Prerequisites

Be logged in once — the tool reuses the same stored credentials as the muggle
MCP tools (`~/.muggle-ai`), so it needs no environment variables:

```
muggle login
```

## Commands

Run via `tsx` from the repo root.

```
# Cold-start the golden set from one project (list projects if --project omitted)
tsx internal/studio-gen-eval/src/run.ts import --project <projectId>
tsx internal/studio-gen-eval/src/run.ts import

# Run the batch
tsx internal/studio-gen-eval/src/run.ts run \
    [--runs N]            # generations per case (default 5)
    [--concurrency C]     # parallel reps (default 2; keep low to avoid login lockout)
    [--timeout S]         # per-rep budget in seconds (default 480)
    [--flags k=v,k2=v2]   # studio feature flags applied to the whole batch (A/B)
    [--cases id,id]       # restrict to specific test case ids
    [--dry-run]           # print the plan without generating
    [--resume]            # continue an interrupted batch from reports/partial.jsonl

# Re-render a report (latest if --batch omitted)
tsx internal/studio-gen-eval/src/run.ts report [--batch <id>]
```

## Files

- `golden-set.json` — the committed golden set: each case pins its live id plus a
  frozen snapshot (`bodyHash`) of the generation-relevant fields. Before a batch
  the tool re-fetches each case and warns on drift.
- `reports/<batchId>.json` + `.md` — per-batch results; `partial.jsonl` is the
  in-progress log consumed by `--resume`.

## How a rep is scored

Each repetition is classified into one of three outcomes:

- **pass** — the studio reported a passing verdict.
- **fail** — the studio ran and reported a failing verdict; counts against the
  pass-rate. The free-text reason is bucketed (element-index drift, date-picker
  gap, unresolved secret, scroll-container blindness, …).
- **error** — no trustworthy verdict: account lockout, invalid credentials,
  rate-limit, timeout, crash. Excluded from the pass-rate so self-inflicted infra
  noise can't fake a regression.

`pass-rate = passes / (passes + fails)`.

## Caveat

Success is the studio's own self-reported verdict, so the pass-rate is an
optimistic ceiling: a script that reports pass but doesn't actually verify the
behaviour (false-pass) is counted as a success. Layering a judge to catch that is
deliberately out of scope for now.

## Feature-flag A/B

`--flags` are forwarded on the generation request's `workflowParams.featureFlags`.
Whether a given flag changes studio behaviour depends on backend support for that
flag; the tool threads them through but does not itself guarantee an effect.

## Regression baseline

`golden-set.json` is committed, so a batch is reproducible and comparable over
time. The baseline below is the reference point: re-run the batch after any
change that could touch generation, and compare both numbers.

- **Batch:** `gen-eval-2026-08-13T00-03-03` (2026-08-13)
- **Golden set:** 8 cases from project `301f55a9-64c0-404d-a8fa-7e28513a4b6e`
  ("Firebasestorage v0 Testing") — two each of radio, textarea, checkbox and
  colour-picker, every case pinned to one frozen static test page so the
  fixture cannot rot underneath the baseline.
- **Runs per case:** 5 (40 reps), concurrency 2
- **Overall pass-rate: 100.0%** over **38 scored reps**
- **Infrastructure errors: 2** (bucket `crash`)

Report: `reports/baseline-gen-eval-2026-08-13T00-03-03.md`.

**Read the denominator, not just the rate.** Errors are excluded from the
pass-rate, so a harness that drops reps still reports a healthy percentage — it
just reports it over less evidence. A batch that scores well below 38 is a
broken instrument, not a passing run, and must be investigated before its
pass-rate is trusted. The first attempt at this baseline scored 11/40 and
reported the same 100.0%; the missing 27 reps were generations the poll loop
abandoned mid-restart.

Keep `--concurrency` at 2. Higher fan-out trips the account lockout that shows
up as `account-lockout` buckets and poisons the baseline.
