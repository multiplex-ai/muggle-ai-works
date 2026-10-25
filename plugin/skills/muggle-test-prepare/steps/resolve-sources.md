# Resolve service sources

Decide which checkout every service runs from. Runs on every invocation, right after [rebase-check](./rebase-check.md); the recipe names each service's repo, never the checkout to run.

## Repos under test

The repo containing the caller's working directory is a **repo under test**; its checkout is that directory's checkout root (`git rev-parse --show-toplevel`) — a linked worktree or the main working tree alike. Each `directoryOverrides` entry adds another, with the override as its checkout.

## Run directory

A plan entry's `dir` is the repo's main working-tree root plus the service's sub-directory inside it. Its **run directory**:

| Service's repo | Runs from |
| :------------- | :-------- |
| A repo under test | `<that checkout>/<sub-directory>` |
| Any other repo | `<main-root>/.claude/worktrees/base-<default>/<sub-directory>` — the repo's **base checkout** |

A repo's main working tree is a run directory only when it is the caller's own checkout. Otherwise what it has checked out is whatever its last user left there — the reason a recipe's services drift months behind.

## Base checkout

A detached worktree pinned to the latest `origin/<default>`, shared by every session on this machine: sibling services always run the main line, and two sessions needing the same backend share one process instead of fighting over its port.

1. `git -C <main-root> fetch --no-tags origin "+refs/heads/<default>:refs/remotes/origin/<default>"`
2. Missing → `git -C <main-root> worktree add --detach <main-root>/.claude/worktrees/base-<default> origin/<default>`
3. HEAD ≠ `origin/<default>` → `git -C <base-checkout> checkout --detach --force origin/<default>` — only while the local execution lane is free or held by the caller: `muggle-local-execution-lane-status` with the caller's checkout as `cwd` reports `free` or `held-by-you`. A peer's run in flight keeps the base where it is; the readiness table then shows how far it trails, and the next invocation refreshes it.

Nothing is ever committed in a base checkout; `--force` discards stray edits.

## Legacy plan entries

An entry saved before this rule names a checkout directly. Normalize it in memory, and in the saved plan on its next write:

- A path inside a linked worktree (`…/.claude/worktrees/<name>/…`, or one whose `git rev-parse --git-common-dir` is not its own `.git`) → its repo's main working-tree root plus the remaining sub-directory.
- A path that no longer exists → cut at `/.claude/worktrees/`; the prefix is the main root. Gone with no such segment → drop the entry, per [reuse-plan](./reuse-plan.md).

## Output

For each service: its run directory, whether it is under test or from a base checkout, and the commit it must serve (`git -C <run-dir> rev-parse HEAD`). These travel in the resolved plan; [check-running](./check-running.md) proves every listener against them.
