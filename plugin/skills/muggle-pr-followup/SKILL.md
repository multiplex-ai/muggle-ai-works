---
name: muggle-pr-followup
description: Generic per-PR follow-up loop. One polling tick per dispatch. Watches one PR for new submitted reviews; when an actionable review lands, invokes the caller's implementation cycle (build/test/walkthrough/push handler the caller declares), then resumes polling. Use as `/loop 1m /muggle:muggle-pr-followup <session-slug> <pr-number>`. Caller-agnostic — `muggle-do` is the first caller but not the last.
disable-model-invocation: true
---

# Muggle PR Follow-up

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-pr-followup"`.

A generic loop that babysits one open PR until it's merged or closed. Polls for submitted reviews; on an actionable review, dispatches the caller's implementation cycle to re-build, re-test, refresh the walkthrough, and push.

**Per-PR isolation.** One dispatch per PR, not per session. Multi-PR work runs N independent loops.

## Input

`$ARGUMENTS = <session-slug> <pr-number>`. The session-slug is the directory basename under `.muggle-<caller>/sessions/` (e.g. `.muggle-do/sessions/`) that this loop reads its state from. The pr-number identifies which PR in that session's manifest this loop watches.

- Empty / `help` / `?` → list active `(slug, pr-number)` pairs across known callers, exit.
- One argument → ambiguous; list PRs under that slug, exit.
- Two arguments → resolve and run one tick.

## Contract

The per-tick contract — termination check, allow-list resolution, review polling, classify, cycle dispatch, escalation, telemetry — lives in [`contract.md`](contract.md). Read it before driving a tick.

## Caller-supplied implementation cycle

The skill itself is caller-agnostic. When an actionable review lands, it invokes the **implementation cycle** declared by the caller in the session's `cycle.json`:

```json
{
  "cycleName": "muggle-do dev cycle",
  "steps": [
    { "stage": 3, "file": "../do/build.md" },
    { "stage": 4, "file": "../do/impact-analysis.md" },
    { "stage": 5, "file": "../do/unit-tests.md" },
    { "stage": 6, "file": "../do/e2e-acceptance.md" },
    { "name": "post-walkthrough", "skill": "muggle-pr-visual-walkthrough", "mode": "A" }
  ],
  "pushHandler": "git push origin <branch>"
}
```

The cycle's job: read the amended `requirements.md`, run each declared step, push to the existing branch. The cycle returns one of `pushed | escalated | failed`. The skill doesn't care what's inside the steps — it just iterates them, captures the outcome, and writes a reply summary referencing the new SHA.

Callers without a `cycle.json` are rejected with `no cycle declared — caller must seed cycle.json at dispatch time`.

## Subagent dispatch (optional)

A caller may declare `"useSubagent": true` in `cycle.json`. When set, the implementation cycle runs as a separate Claude subagent rather than inline in the loop's tick — gives stronger isolation per PR but adds overhead per cycle. Default is inline (which is itself isolated per-tick via `/loop`).

## Design adjustment escalation

When the implementation cycle reports back that the review requires not just code change but a **design adjustment** beyond what the current requirements support (e.g. the build stage discovers the requested change conflicts with a load-bearing assumption), the cycle returns `failed: design-adjustment`. The loop treats this like an ambiguous escalation but with a different terminal message that points at the design conflict and asks the user to decide.

## Why a separate skill (and not e.g. inside the caller's own skill folder)

`/loop` dispatches via slash command; slash commands resolve to top-level skills under `plugin/skills/`. A per-tick loop driven by `/loop` therefore has to live as a top-level skill. Putting the loop's content directly inside a caller-specific folder would make `/loop`-dispatch impossible (or fragile via shell-only entry points). Keeping the loop generic and caller-agnostic is what lets `/loop` dispatch into it cleanly.
