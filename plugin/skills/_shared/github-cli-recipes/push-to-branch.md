# Push to the PR branch

After the address-reviews cycle's work.

```bash
git -C <repo-path> push origin <head-ref-name>
git -C <repo-path> rev-parse HEAD
```

Append the new SHA to `last_seen.pushed_shas[]` so resolve-reminder can recognize it.
