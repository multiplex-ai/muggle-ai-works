---
name: muggle-pr-followup
description: Watcher loop for PR review follow-ups. Polls one PR for new submitted reviews and dispatches `/muggle-do` (address-reviews mode) when there are any. A dumb pipe — no classification, no cycle execution, no replies. Use `/loop 1m /muggle:muggle-pr-followup <slug> <pr-number>` for ongoing polling, or `/muggle:muggle-pr-followup <pr-url>` to bootstrap a fresh watcher on an existing PR.
disable-model-invocation: true
---

# muggle-pr-followup

> Telemetry first step: see [`../_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-pr-followup"`.

A watcher that babysits one open PR's review thread. Polls for new submitted reviews; when any land, hands them off to `/muggle-do` and exits. `/muggle-do` is the executor — it classifies the reviews, runs the work, pushes, replies per comment, and respawns the watcher.

**The watcher is a dumb pipe.** It does not classify reviews, iterate cycles, post replies, or escalate. All of that lives in `/muggle-do`. See [stage-8 design](../../../../muggle-ai-brain/architecture/2026-05-08-muggle-do-pr-comment-loop-design.md) for the rationale.

**Per-PR isolation.** One watcher per PR. Multi-PR work runs N independent watchers.

## Routing

The skill recognizes two modes by inspecting `$ARGUMENTS` and falling back to on-disk state. It never runs procedure inline — it identifies the mode and routes to the appropriate procedure file.

| Input | On-disk check | Mode |
| :---- | :------------ | :--- |
| First arg matches `https?://github\.com/[^/]+/[^/]+/pull/\d+` | — | **bootstrap** → [`bootstrap.md`](bootstrap.md) |
| `<slug> <pr-number>` | session dir for `<slug>` exists | **tick** → [`contract.md`](contract.md) |
| `<slug> <pr-number>` | session dir missing | **error:** "no session at `<path>`; pass a PR URL to start one" |
| `<pr-number>` alone | exactly one existing session contains it | **tick** for that PR |
| `<pr-number>` alone | zero or multiple matches | **error:** ambiguous; list candidates and exit |
| empty / `help` / `?` | — | **help:** list active loops per [`output-templates.md`](output-templates.md#help-output) |

Bootstrap accepts two optional trailing flags:

- `--slug=<name>` — override the default `<repo>-pr<n>` slug
- `--resume` — opt in to reusing an existing session slot (default is refuse on conflict)

## Folder TOC

See [`CLAUDE.md`](CLAUDE.md) for the one-line index of every file in this folder.

## Why a separate skill (and not inside `/muggle-do`)

`/loop` dispatches via slash command; slash commands resolve to top-level skills under `plugin/skills/`. A per-tick loop driven by `/loop` therefore has to live as a top-level skill. Folding it into `/muggle-do` would break `/loop`-dispatch. The dumb-pipe shape keeps the watcher minimal so the separation has low surface area.
