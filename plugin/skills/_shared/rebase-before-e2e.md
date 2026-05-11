# Rebase Onto the Default Branch Before Dev Server / E2E

Before starting a dev server or running E2E acceptance tests on a local branch, check whether the branch is behind `origin/<default>`:

```bash
git fetch origin
default=$(git symbolic-ref refs/remotes/origin/HEAD --short | sed 's|origin/||')
behind=$(git rev-list --count "HEAD..origin/${default}")
```

If `behind > 0`, surface a recommendation via `AskUserQuestion`:

- "Rebase onto `origin/<default>` first (recommended — `behind` commits behind)"
- "Run anyway against the current branch"

**Why:** dev servers and E2E tests against a stale branch can reproduce bugs that were already fixed on the default branch, or miss interactions with newly-merged code. The result: false failures or false greens that waste the user's review time.

If the rebase has conflicts, stop and report — do not attempt to resolve automatically.

This is a **recommendation** — never run the rebase without the user's confirmation.
