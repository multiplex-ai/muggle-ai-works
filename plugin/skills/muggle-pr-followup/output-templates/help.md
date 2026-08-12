# Help output

For `/muggle:muggle-pr-followup help` or `?` (no args runs **auto-track** instead — see [`../auto-track.md`](../auto-track.md)):

```
muggle-pr-followup — watcher loop for PR review follow-ups

Active loops (this session):
  <slug> → <owner>/<repo>#<n> (<N> cycles)
  ...
  (or "no active loops")

Owned by other sessions (not watched here):
  <slug> → <owner>/<repo>#<n>
  ...
  (omit this block entirely when there are none)

Usage:
  /muggle:muggle-pr-followup                     → auto-track every PR you pushed this session
  /muggle:muggle-pr-followup <pr-url>            → bootstrap a new loop
  /muggle:muggle-pr-followup <slug> <pr-number>  → run one tick (called by /loop)
  /muggle:muggle-pr-followup <pr-number>         → run one tick (slug inferred from on-disk state)
  /muggle:muggle-pr-followup reconcile           → finalize terminal slots, re-arm your own dead watchers
  /muggle:muggle-pr-followup adopt [<slug>]      → take over a slot from a dead session (no slug lists them)
  /muggle:muggle-pr-followup stop [<slug>]       → tear down a watcher (no slug stops everything)
```

Split the two blocks by `owner.json` against `$CLAUDE_CODE_SESSION_ID` ([`../state-schemas.md`](../state-schemas.md#ownerjson)). Listing a foreign slot under "active loops" would claim this session is watching a PR nothing here polls.
