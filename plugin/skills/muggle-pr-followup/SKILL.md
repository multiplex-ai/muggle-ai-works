---
name: muggle-pr-followup
description: "Use when the user wants a pull request's incoming review feedback handled for them — it watches one PR's review thread and, each time a reviewer submits new comments, dispatches the work to address them. Engage on PR-review-follow-up intent: \"watch my PR and address review comments as they come in\", \"keep an eye on PR #123 and respond to reviewer feedback\", \"babysit my PR's review thread\", \"I'm stepping away — handle my PR's reviews while I'm gone\". This is PR-review-specific automation — prefer it over the generic loop skill. It only watches and dispatches; the actual edits and replies are muggle-do. Not for posting test results to a PR (use muggle-pr-visual-walkthrough)."
---

# muggle-pr-followup

> Telemetry first step: see [`../_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-pr-followup"`.

A watcher that babysits one open PR's review thread, CI, and merge-conflict state. Polls for new submitted reviews, check-run state, and mergeability; when review feedback lands, CI goes red, or the branch conflicts with its base, hands the work to `/muggle-do` and exits. On merge or close, it hands the terminal wrap-up to `/muggle-do` the same way — teardown when merged, then a next-step suggestion. `/muggle-do` is the executor — it classifies the reviews, fixes the failing checks, or rebases-and-resolves the conflict, pushes, replies per comment, and respawns the watcher.

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
- `--forward-only` — pin `lastBodyReviewId` past existing **body-only** reviews (skip history on those). Line-comment threads are always picked up from live thread state, regardless of this flag.

## Preferences

| Preference | Gate |
| :--------- | :--- |
| `autoReuseValidationContext` | Bootstrap reuses an existing validation context instead of re-asking — fired in the Step 6.5 gather per [`../_shared/resolve-e2e-validation-context.md`](../_shared/resolve-e2e-validation-context.md) |

## Folder TOC

See [`CLAUDE.md`](CLAUDE.md) for the one-line index of every file in this folder.
