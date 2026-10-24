# Next-Step Suggestion

Closing step of a terminal `/muggle-do` turn (post-merge or post-close). Advances silently when the session still has a plan; otherwise reports where this chat's work stands, then asks what to do next.

## Input

- `slug` — the session.
- `teardownRan` — whether [`cleanup.md`](cleanup.md) already ran teardown (true on `merged` + `autoCleanup: always`; false on `closed` or a skipped gate).
- `terminalRecord` — `<slug>`'s [terminal record](cleanup.md#terminal-record), captured before teardown could delete its slot and completed with its `teardown` note.

## This chat's work

"This chat" is the Claude Code session running the turn, `$CLAUDE_CODE_SESSION_ID`. Its work is `<slug>`, every PR in its [chat ledger](cleanup.md#chat-ledger) — PRs it finished, whose slots teardown may have deleted — and every slot under `~/.muggle-ai/muggle-do/sessions/` whose [`owner.json`](../muggle-pr-followup/state-schemas.md#ownerjson) records that id — the owned side of reconcile's split ([`reconcile.md`](../muggle-pr-followup/reconcile.md#step-1--enumerate-and-partition-slots)), finalized slots included. Every other slot holding a `prs.json` is another chat's work. With the id unset, this chat's work is `<slug>` alone.

The sessions directory holds every chat's slots, so a selector drawn from the whole directory offers work this chat never touched. Report and follow-ups cover this chat only; other chats sit behind one explicit option.

## Procedure

1. Read the session plan — the current session's TodoWrite list.
2. **Pending items remain** → do not prompt. Append `next-step: plan has <N> pending — advancing` to `followup.log` and continue to the next pending item. The user set a course; honor it.
3. **No pending items** → print the [status block](#status-block), then ask with one `AskUserQuestion` [selector](#selector). The status block always comes first: a selector without it asks the user to decide blind.
4. Append the chosen outcome to `followup.log`.

Both appends target `<slug>`'s `followup.log` and are skipped once teardown's report marks `Session slot cleared` ✅ — the log went with the slot, and an append would recreate the directory.

## Status block

One line per PR of this chat's work, `<slug>` first, the rest newest first, then the `Left over` line:

```
This chat's work:
  merged   acme/widget#142 — Add CSV export · cleaned up
  open     acme/widget#145 — Rate-limit login · CI green · 2 threads open · watcher live
  blocked  acme/widget#147 — Retry webhooks · awaiting you: resolve the rebase conflict
  closed   acme/widget#139 — Old approach · unmerged, branch kept
Left over: #145 shipped [E2E FAILING]; review 2210 on #142 escalated
```

- **`<slug>`** is built from `terminalRecord`, never from the slot on disk — teardown may have deleted it. Its teardown note is the record's `teardown`.
- **Finished PRs** — the ledger's other records, each line built from its record and its `teardown` note. A PR in the ledger is listed once, from the ledger, even while its slot is still on disk.
- **Other terminal slots** (`merged`, `closed`) not in the ledger read `prs.json` and `result.md`; the teardown note comes from the cleanup line in `followup.log`.
- **Open slots** refresh live. Resolve the provider per [`detect-vcs.md`](../_shared/vcs/detect-vcs.md) and use its PR-metadata and unresolved-thread recipes ([`github.md`](../_shared/vcs/github.md), [`gitlab.md`](../_shared/vcs/gitlab.md)); CI per [`ci-rollup.md`](../_shared/vcs/common/ci-rollup.md). The watcher reads `live` when [`watch-heartbeat`](../muggle-pr-followup/state-schemas.md#watch-heartbeat) is fresh, `stopped` otherwise.
- **Blocked** replaces `open` when `last_seen.json` carries `blocked`; the line names the pending act per [`blocked-reminder.md`](../muggle-pr-followup/output-templates/blocked-reminder.md).
- **`Left over`** lists what this chat's slots recorded as unfinished: a waiver or Blocker in `state.md`, an `[E2E FAILING]` ship, escalated review ids in `result.md` — for `<slug>` and every ledger record, the record's `waivers`, `e2eFailing` and `escalatedReviewIds`. `nothing` when empty.

No other chat's slot or ledger appears in the block.

## Selector

At most four options, in this order:

1. **This chat's follow-ups** — up to two, each naming the status-block line it acts on. Candidates, highest first: unblock a `blocked` PR; **Clean up now** for `<slug>` when `teardownRan` is false, running [`../_shared/post-merge-cleanup.md`](../_shared/post-merge-cleanup.md) for this slug under its own safety rules; re-arm a `stopped` watcher on an open PR; address a `Left over` item. Anything the status block does not show is never offered — no generic suggestion, no other chat's PR. Candidates past the first two stay reachable through the free-text answer.
2. **Other chats' work** — always present; the gear shift. Lists every unfinalized slot of another chat (no `result.md`, name not ending in `.stopped`) as `<slug> → <owner>/<repo>#<n> — <title> (<state>)`, newest first, from each slot's `prs.json` and `last_seen.json`, or `No other chat has open work.` Then one selector: up to three of those slots to adopt per [`adopt.md`](../muggle-pr-followup/adopt.md), plus **Done**. Listing adopts nothing; a slot changes hands only when the user picks it.
3. **Done — stop here** — exit with no further action.

A new task goes through the selector's free-text answer, which starts a fresh `/muggle-do` forward run.
