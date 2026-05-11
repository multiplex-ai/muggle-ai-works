# Rebase Onto the Default Branch Before Dev Server / E2E

Gated by [`autoRebase`](../muggle-preferences/preference-gates/autoRebase.md). Follow the standard procedure in [`preference-gates/README.md`](../muggle-preferences/preference-gates/README.md).

**Fire only when `behind > 0`:**

```bash
git fetch origin
default=$(git symbolic-ref refs/remotes/origin/HEAD --short | sed 's|origin/||')
behind=$(git rev-list --count "HEAD..origin/${default}")
```

Pass `{behind}` and `{default}` to the picker prompts. On `always`, run `git rebase origin/${default}`; stop and report on conflicts — never auto-resolve.

Stale branches produce false failures and false greens — that's why this gate exists.
