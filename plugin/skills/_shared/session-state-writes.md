# Writing session-state files

How to update the session-state JSON — `last_seen.json` and `prs.json` under `~/.muggle-ai/muggle-do/sessions/<slug>/`. Field shapes: [`../muggle-pr-followup/state-schemas.md`](../muggle-pr-followup/state-schemas.md). Both the watcher and `/muggle-do` write these.

## Mechanism — tool-based, OS-agnostic

To apply any `increment` / `reset` / `set` / `append` a procedure calls for:

1. **Read** the whole file (Read tool).
2. Change the one field in the parsed JSON.
3. **Write** the whole file back (Write tool).

A whole-file rewrite with the Read and Write tools. These are platform-independent — no shell — so the same three steps hold on Windows, macOS, and Linux.

**Never use the Edit tool on these files.** Edit needs its `old_string` to match the file's exact bytes, but the on-disk formatting isn't guaranteed to match the shapes documented in `state-schemas.md` — a writer may emit the JSON on a single line. A mismatched `old_string` silently fails: the edit is dropped ("malformed edit") and the value never changes. A whole-file Write can't miss.

If you script the rewrite instead of using the Write tool, any tool that replaces the **whole file** is fine — e.g. `jq '…' file > tmp && mv tmp file` in a POSIX shell, or the equivalent `Get-Content`/`Set-Content` in PowerShell. The rule is only: whole file, never a partial Edit.

## Field map

- `last_seen.json` — one object keyed by `"<owner>/<repo>#<n>"`. Mutate fields under that key: `idle_tick_count`, `cycles_completed` (counters), `last_pushed_sha`, `lastBodyReviewId` (scalars), `pushed_shas`, `escalated_review_ids`, `ci_escalated_shas`, `conflict_escalated_shas` (arrays), `ci_fix_attempts[<sha>]`, `conflict_resolve_attempts[<sha>]` (per-SHA maps).
- `prs.json` — a one-element array. Mutate `[0]`: `head_sha`, `state`.
