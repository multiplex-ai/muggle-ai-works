---
name: muggle-pr-followup
description: Use this skill to watch one open pull request's review thread and follow up automatically — it polls the PR for newly submitted reviews and, when any land, hands them to `/muggle-do` to address. Engage whenever the user wants ongoing PR review follow-up: "watch my PR for review comments and address them", "keep an eye on PR #123 and respond to reviews as they come in", "follow up on my PR's reviews", "babysit this PR's review thread". Run with no args to auto-track every PR you pushed this session (any repo); pass a PR URL to bootstrap a watcher on a specific PR; or `/loop 1m /muggle:muggle-pr-followup <slug> <pr-number>` for ongoing polling. It is a dumb pipe — it only polls and dispatches; classification, edits, replies, and E2E live in `/muggle-do`. Not for posting test results to a PR (use muggle-pr-visual-walkthrough) or for a one-off implementation with no review-watching (use muggle-do).
---

# muggle-pr-followup

> Telemetry first step: see [`../_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-pr-followup"`.

A watcher that babysits one open PR's review thread. Polls for new submitted reviews; when any land, hands them off to `/muggle-do` and exits. `/muggle-do` is the executor — it classifies the reviews, runs the work, pushes, replies per comment, and respawns the watcher.

**The watcher is a dumb pipe.** It does not classify reviews, iterate cycles, post replies, or escalate. All of that lives in `/muggle-do`. See [stage-8 design](../../../../muggle-ai-brain/architecture/2026-05-08-muggle-do-pr-comment-loop-design.md) for the rationale.

**Per-PR isolation.** One watcher per PR. Multi-PR work runs N independent watchers.

## Routing

The skill recognizes its mode by inspecting `$ARGUMENTS` and falling back to on-disk state. It never runs procedure inline — it identifies the mode and routes to the appropriate procedure file.

| Input | On-disk check | Mode |
| :---- | :------------ | :--- |
| First arg matches `https?://github\.com/[^/]+/[^/]+/pull/\d+` | — | **bootstrap** → [`bootstrap.md`](bootstrap.md) |
| `<slug> <pr-number>` | session dir for `<slug>` exists | **tick** → [`contract.md`](contract.md) |
| `<slug> <pr-number>` | session dir missing | **error:** "no session at `<path>`; pass a PR URL to start one" |
| `<pr-number>` alone | exactly one existing session contains it | **tick** for that PR |
| `<pr-number>` alone | zero or multiple matches | **error:** ambiguous; list candidates and exit |
| empty | — | **auto-track** → [`auto-track.md`](auto-track.md) |
| `help` / `?` | — | **help:** list active loops per [`output-templates/help.md`](output-templates/help.md) |

Bootstrap accepts three optional trailing flags:

- `--slug=<name>` — override the default `<repo>-pr<n>` slug
- `--resume` — opt in to reusing an existing session slot (default is refuse on conflict)
- `--forward-only` — pin cursor past existing reviews (skip history). Default is cursor 0, which processes prior submitted reviews on the first tick.

## Preferences

| Preference | Gate |
| :--------- | :--- |
| `autoReuseValidationContext` | Bootstrap reuses an existing validation context instead of re-asking — fired in the Step 6.5 gather per [`../_shared/resolve-e2e-validation-context.md`](../_shared/resolve-e2e-validation-context.md) |

## Folder TOC

See [`CLAUDE.md`](CLAUDE.md) for the one-line index of every file in this folder.
