# PR metadata snapshot

Fetch the fields the watcher and bootstrap need in one call.

```bash
gh pr view <pr-number> --repo <owner>/<repo> \
  --json url,number,headRefOid,headRefName,baseRefName,state,mergeable,mergeStateStatus,mergedAt,closedAt,body,title,author
```

- `state` is one of `OPEN`, `MERGED`, `CLOSED`.
- `headRefOid` is the current head SHA — store as `head_sha` in `prs.json`.
- `headRefName` is the branch — must match the working tree's branch in bootstrap.
- `mergeable` is `MERGEABLE`, `CONFLICTING`, or `UNKNOWN` (GitHub still computing — treat as not-conflicting this tick). `mergeStateStatus` (`DIRTY` = conflicts, `BEHIND`, `CLEAN`, …) corroborates it. The watcher uses these to detect a merge-conflict that no review or CI signal would surface.
