# Sync the Branch With Its Base

Bring the working branch up to date with the branch it merges into — before a dev server or E2E run, and before any push that opens or updates a change. Gated by [`autoRebase`](../muggle-preferences/preference-gates/autoRebase.md). Follow the standard procedure in [`preference-gates/README.md`](../muggle-preferences/preference-gates/README.md).

## Resolving the base

`base` is the branch the work merges into, which is not automatically the remote default — pre-flight lets the user target a different branch, and once a change exists its `baseRefName` is authoritative. A caller holding a base passes it in; fall back to the remote default only when no target was chosen.

## Checking freshness

`muggle checkout-freshness` fetches the base and returns one verdict. Run it in the checkout:

```bash
base="${base:-$(git symbolic-ref refs/remotes/origin/HEAD --short | sed 's|origin/||')}"
muggle checkout-freshness --base "${base}" --json
```

| Verdict | Meaning | Action |
| :------ | :------ | :----- |
| `FRESH` | HEAD contains `origin/${base}` | None |
| `NOT_APPLICABLE` | Not a git checkout, no `origin`, or no such base | None — nothing to check |
| `BEHIND_BASE` | HEAD lacks `behindBy` commits of `origin/${base}` | [Rebase](#rebasing) |
| `FOREIGN_BASE` | The branch was cut from another branch's unmerged commits (`inheritedCommits`) | [Stop](#foreign-base) |

Pass `{behind}` (the report's `behindBy`) and `{base}` to the picker prompts. A report with `hasFetchFailed: true` judged against the last fetched base — say so in one line and act on the verdict.

## Rebasing

On `always`:

1. Capture the rollback point: `pre_rebase_sha=$(git rev-parse HEAD)`.
2. `git rebase origin/${base}`.
3. On conflict, branch by [`autoResolveConflicts`](../muggle-preferences/preference-gates/autoResolveConflicts.md):
   - `never` → `git rebase --abort`; stop and report, naming the conflicted files. Never auto-resolve.
   - `always` → hand off to [`resolve-rebase-conflicts.md`](resolve-rebase-conflicts.md) with `pre_rebase_sha` to resolve the conflicts, then run the [`verify-or-rollback-gate.md`](verify-or-rollback-gate.md) with `pre_rebase_sha`; it either proceeds or restores `pre_rebase_sha` and escalates.

A dev server already running from this checkout still serves the pre-rebase code: restart it before testing.

## Before a dev server or E2E run

The code under test always contains the latest `origin/${base}`. `autoRebase` decides only whether the rebase happens without asking, never whether stale code runs:

- `always` → rebase.
- `ask` → Picker 1. `Rebase first` rebases; `Don't rebase` stops the run.
- `never` → stop the run.

A stop names the checkout, the verdict and `behindBy`, and starts nothing. There is no run-as-is: a stale tree produces false failures and false greens, and the local execute tools refuse a stale loopback run regardless, so running as-is only moves the failure later.

## Foreign base

`FOREIGN_BASE` stops the run or push whatever `autoRebase` says — a rebase would carry the inherited commits along. Report the branch they came from and `inheritedCommits`. The fix is a decision about someone else's work, so it is the user's:

- Recreate the branch with `origin/${base}` as its explicit start point and carry over only the change's own commits.
- Or, when the change deliberately stacks on that branch, name it as the base and re-check.

## Before a push

`BEHIND_BASE` → rebase per `autoRebase`; on `never` the push goes ahead as-is, and the remote's merge checks own that decision. `FOREIGN_BASE` → [stop](#foreign-base).

## Branches already on the remote

The rebase rewrites history, so a branch the remote already has needs a force-push to land it. Never force-push from here. A caller in that position hands the sync to its own rebase mode, which owns the per-SHA attempt budget and the verify-or-rollback gate wrapped around the force-push.

Stale branches produce false failures and false greens, and a branch that goes stale between validation and push opens a change that cannot merge — that is why this gate exists.
