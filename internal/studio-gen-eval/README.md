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
