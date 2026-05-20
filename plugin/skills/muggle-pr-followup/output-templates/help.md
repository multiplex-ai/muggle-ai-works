# Help output

For `/muggle:muggle-pr-followup` with no args, or with `help` / `?`:

```
muggle-pr-followup — watcher loop for PR review follow-ups

Active loops:
  <slug> → <owner>/<repo>#<n> (cursor @ review #<id>, <N> cycles)
  ...
  (or "no active loops")

Usage:
  /muggle:muggle-pr-followup <pr-url>            → bootstrap a new loop
  /muggle:muggle-pr-followup <slug> <pr-number>  → run one tick (called by /loop)
  /muggle:muggle-pr-followup <pr-number>         → run one tick (slug inferred from on-disk state)
```
