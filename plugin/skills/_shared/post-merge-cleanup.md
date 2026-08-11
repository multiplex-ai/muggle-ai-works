# Cleanup After the Change Is Merged

Gated by [`autoCleanup`](../muggle-preferences/preference-gates/autoCleanup.md). Follow the standard procedure in [`preference-gates/README.md`](../muggle-preferences/preference-gates/README.md). Fire only after the PR is **merged** — never while it's still open.

On `always`, the steps below run as one pre-authorized sequence (no per-step prompts). Stop on the first failure; do not force.

**Verify every step, assume none.** Each step states what proves it succeeded. A step whose side effect *usually* happens is not a step that ran — that assumption is how a branch survives a cleanup that reported success. The [report](#report) states verified state, never intent.

## Preconditions

Confirm the PR is `MERGED` from provider state. A closed-unmerged PR keeps its branch and worktree: the work never landed, so deleting it destroys it.

## 1. Remove the worktree — link-safe

Only if a worktree was used.

A worktree's dependency dir (`node_modules`, and nested workspace copies) is often a **link** — a symlink or a Windows junction — to a shared tree rather than a real copy. A forced or recursive delete follows the link and wipes that shared target, breaking every other worktree.

1. **Never `--force`.** It is the one flag that follows links.
2. Clear the dependency and build dirs first, nested workspace ones included (`packages/*/node_modules`, `dist`). A plain `git worktree remove` fails with `Directory not empty` while they remain, and the obvious fix for that error is exactly the forbidden flag.
   - A **link** → unlink it first with the host OS's unlink, removing the link only and never its target.
   - A **real directory** → delete it in place.
   Check which it is before deleting; the two are indistinguishable from a listing but not from a `rm -r`.
3. Then plain `git worktree remove {worktreePath}`.
4. `git worktree prune` to drop the administrative entry when the directory went away out from under git.

**Verify:** the path is gone, it no longer appears in `git worktree list`, **and** the shared dependency tree the links pointed at still exists. That last check is the one that catches a link-follow.

## 2. Delete the local branch

**Skip entirely when no worktree was used** — the branch is then the user's live checkout, and a checked-out branch must never be deleted.

`git branch -d` refuses after a **squash merge**, and always will: squashing mints a new commit carrying the same tree, so the branch tip is never an ancestor of the base. This is not a safety check that failed; it is one that cannot pass.

Do not reach for `-D` on faith. Replace the ancestry check with a content check:

1. Confirm the merged content is on the base — files the PR added exist at `origin/<base>`, and anything it removed is absent there.
2. Only then `git branch -D {branch}`.

**Verify:** the branch is absent from `git branch --list`.

## 3. Delete the remote branch

**A provider that auto-deletes the head branch on merge is a setting, not a guarantee.** It can be off for the repo, off for a fork, or simply not fire. Treat auto-delete as something to detect, never as this step having run.

1. Query the ref. Already gone → record it deleted and move on.
2. Still present → delete it explicitly.

**Verify:** querying the ref returns not-found.

## 4. Clear the session slot

The slot is `~/.muggle-ai/muggle-do/sessions/<slug>/` — the home directory, not the project.

Clear it only when `prs.json` records a terminal state. A slot for a still-open PR is live state that a watcher and [`reconcile`](../muggle-pr-followup/reconcile.md) both read. The merged PR is the durable record, so the slot's `result.md` is not lost history.

**Verify:** the slot directory is gone, and no non-terminal slot was touched.

## 5. Clear this run's prepare artifacts

The PID tracker and per-service logs written during environment prep — `/tmp/muggle-test-prepare.json` and `/tmp/muggle-prepare-*.log`.

**Only this run's.** Artifacts belonging to another session are not yours to delete; it may be mid-prepare with services running. When the tracker is absent no services are tracked, so any remaining logs are orphaned — report them rather than removing them.

Cloud results always stay.

**Verify:** this run's artifacts are gone; anything left is named in the report as out of scope.

## Report

Print as the last action, one row per step, filled from the verification checks — never from the fact that a command was issued:

```
Cleanup — <slug> (PR #<n>, merged)

| Step                  | Result                                          |
|:----------------------|:------------------------------------------------|
| Worktree removed      | ✅ .claude/worktrees/<name> (shared deps intact) |
| Local branch deleted  | ✅ users/<user>/<branch>                         |
| Remote branch deleted | ✅ (already gone — provider auto-delete)         |
| Session slot cleared  | ✅ <slug>                                        |
| Prepare artifacts     | — none for this run                              |
```

Markers: `✅` verified done · `⚠️` done with a caveat worth reading · `❌` not done, with the reason · `—` nothing to do.

Every step gets a row. A step that did not run is `❌` plus its reason — never omitted, and never `✅` when its verification did not actually run. A silent gap is worse than a visible one, because it is the version the user ends up believing.

State anything deliberately left alone — another session's artifacts, a foreign worktree, an orphaned watcher — on a line below the table, so out-of-scope is declared rather than invisible.
