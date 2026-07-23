# Push to the PR branch

After the address-reviews cycle's work.

**Signing gate — never push unsigned commits.** Check what is about to leave: `git -C <repo-path> log --format='%G?' origin/<head-ref-name>..HEAD`. Any `N` → do not push; create the commits server-signed per [`signed-commits.md`](signed-commits.md) (GitHub), or stop and escalate ([`signed-commits.md` § GitLab](signed-commits.md#gitlab) — no server-side signing). Never disable signing to make a push go through.

```bash
git -C <repo-path> push origin <head-ref-name>
git -C <repo-path> rev-parse HEAD
```

Append the new SHA to `last_seen.pushed_shas[]` so resolve-reminder can recognize it.
