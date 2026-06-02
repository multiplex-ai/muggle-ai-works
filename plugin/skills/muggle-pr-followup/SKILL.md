---
name: muggle-pr-followup
description: Use this skill when the user wants a pull request's incoming review feedback handled for them — it watches one PR's review thread and, each time a reviewer submits new comments, dispatches the work to address them. Engage on PR-review-follow-up intent: "watch my PR and address review comments as they come in", "keep an eye on PR #123 and respond to reviewer feedback", "follow up on my PR's reviews", "babysit my PR's review thread", "auto-handle reviews on the PR I just opened", "I'm stepping away — handle my PR's reviews while I'm gone". Run with no args to track every PR you pushed this session (any repo); pass a PR URL to start watching a specific one. This is PR-review-specific automation: when the recurring thing the user wants handled is a PR's review comments, use this — not the generic `loop` skill. It only watches and dispatches; the actual edits and replies are `muggle-do`. Not for posting test results to a PR (use muggle-pr-visual-walkthrough).
---

# muggle-pr-followup

> Telemetry first step: see [`../_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-pr-followup"`.

A watcher that babysits one open PR's review thread and CI. Polls for new submitted reviews and check-run state; when review feedback lands or CI goes red, hands the work to `/muggle-do` and exits. On merge or close, it hands the terminal wrap-up to `/muggle-do` the same way — teardown when merged, then a next-step suggestion. `/muggle-do` is the executor — it classifies the reviews or fixes the failing checks, pushes, replies per comment, and respawns the watcher.

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
| `reconcile` / `sweep` (optional `<slug>`) | — | **reconcile** → [`reconcile.md`](reconcile.md) |

Auto-track runs **reconcile** first, so a no-arg invocation also finalizes any slot whose PR merged or closed while its watcher was down (expired cron, ended session). Reconcile never re-arms a watcher.

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
