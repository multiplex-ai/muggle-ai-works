---
name: muggle-do-pr-followup
description: One polling tick of /muggle-do stage 8 for ONE PR — checks for new submitted reviews on the PR and dispatches the dev cycle when one lands. Dispatched once per PR by `/loop 1m /muggle:muggle-do-pr-followup <slug> <pr-number>` after stage 7; also re-runnable by hand for any session+PR pair.
disable-model-invocation: true
---

# Muggle Test Do — PR follow-up

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-do-pr-followup"`.

This skill is the **dispatch entry** for stage 8 of /muggle-do. It is intentionally thin — the actual per-tick logic lives in [`../do/pr-followup.md`](../do/pr-followup.md), the single source of truth.

One loop per PR: each PR opened by stage 7 gets its own `/loop` dispatching this skill. Multi-repo sessions opening N PRs result in N independent loops, each scoped to one PR's review thread.

## Input routing

`$ARGUMENTS` is `<slug> <pr-number>` — the session directory's basename and the PR number this loop is watching.

- Empty / `help` / `?` → list available `(slug, pr-number)` pairs from `.muggle-do/sessions/*/prs.json` whose state is non-terminal, then exit. Do not start a poll.
- One argument → ambiguous (pre-revision callers passed only the slug); list the PRs under that slug and exit. Do not guess.
- Two arguments → resolve `.muggle-do/sessions/<slug>/` and the entry in `prs.json` whose `number == <pr-number>`. If either the directory, `prs.json`, or the PR entry is missing, log the error to `followup.log` (creating it if needed) and exit. Do **not** ask the user.

## Run one tick

With a valid `(slug, pr-number)`, follow [`../do/pr-followup.md`](../do/pr-followup.md) exactly. That file owns:

- The turn preamble.
- The 9-step per-tick contract.
- The classify rule (actionable / ambiguous, applied to the review as a unit).
- Reply routing.
- Telemetry shapes.
- The self-check before exit.

This skill file adds nothing beyond the argument parsing above.

## Why a separate entry exists

- `/loop 1m /muggle:muggle-do-pr-followup <slug> <pr-number>` (dispatched by stage 7) needs a slash-addressable target.
- Manual re-attach: if a `/loop` for a PR was killed and the user wants to resume, they can re-dispatch the loop themselves, or run `/muggle:muggle-do-pr-followup <slug> <pr-number>` once to drive a single tick.
- Isolated debugging: a single tick is reproducible against a real session dir + PR number.
