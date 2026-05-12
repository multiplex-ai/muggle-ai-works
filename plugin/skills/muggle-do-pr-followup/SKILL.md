---
name: muggle-do-pr-followup
description: One polling tick of /muggle-do stage 8 — addresses reviewer comments and CI failures on PRs opened by an earlier /muggle-do session. Dispatched by `/loop 5m /muggle:muggle-do-pr-followup <slug>` after stage 7; also re-runnable by hand on any session slug.
disable-model-invocation: true
---

# Muggle Test Do — PR follow-up

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-do-pr-followup"`.

This skill is the **dispatch entry** for stage 8 of /muggle-do. It is intentionally thin — the actual per-tick logic lives in [`../do/pr-followup.md`](../do/pr-followup.md), the single source of truth.

## Input routing

`$ARGUMENTS` is the **session slug** (the directory name under `.muggle-do/sessions/`).

- Empty / `help` / `?` → list available session slugs from `.muggle-do/sessions/` that have a non-empty `prs.json` with at least one non-terminal entry, then exit. Do not start a poll.
- Otherwise → resolve `.muggle-do/sessions/<slug>/`. If the directory or its `prs.json` is missing, log the error to `followup.log` (creating it if needed) and exit. Do **not** ask the user.

## Run one tick

With a valid session slug, follow [`../do/pr-followup.md`](../do/pr-followup.md) exactly. That file owns:

- The turn preamble.
- The 9-step per-tick contract.
- The classify rule (directive / question / CI failure / ambiguous → escalate).
- Reply routing.
- Telemetry shape.
- The self-check before exit.

This skill file adds nothing beyond the slug resolution above.

## Why a separate entry exists

- `/loop 5m /muggle:muggle-do-pr-followup <slug>` (dispatched by stage 7 of /muggle-do) needs a slash-addressable target.
- Manual re-attach: if `/loop` was killed and the user wants to resume, they can run `/muggle:muggle-do-pr-followup <slug>` once to drive a single tick, or re-dispatch the `/loop` themselves.
- Isolated debugging: a single tick is reproducible against a real session dir.
