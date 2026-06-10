# MR metadata snapshot

Fetch the fields the watcher and bootstrap need.

```bash
glab mr view <iid> -R <group>/<project> -F json
```

- `state` is one of `opened`, `merged`, `closed`, `locked` (lowercase — unlike GitHub's uppercase).
- `sha` is the current head SHA — store as `head_sha` in `prs.json`.
- `source_branch` is the branch — must match the working tree's branch in bootstrap. `target_branch` is the base.
- conflict comes from `detailed_merge_status`, not a `mergeable` + `mergeStateStatus` pair. The watcher's **conflict** signal is `detailed_merge_status == "broken_status"` or `"conflict"`. `"checking"`/`"unchecked"` means GitLab is still computing — treat as not-conflicting this tick.

## Behind-by (out-of-date detection)

`detailed_merge_status == "need_rebase"` reports a behind branch only when the project enforces "fast-forward merge"; otherwise it stays `mergeable` while behind. Detect out-of-date straight from commit ancestry instead — independent of merge-method config:

```bash
glab api projects/:id/repository/compare?from=<target_branch>&to=<head_sha> --jq '.commits | length'
```

GitLab's compare lists only the commits `to` is ahead by, so flip the direction: compare `from=<head_sha>&to=<target_branch>` and a non-empty `.commits` ⇒ the base has commits the head lacks ⇒ out of date. Empty ⇒ current with base.
