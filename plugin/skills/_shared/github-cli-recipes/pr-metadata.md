# PR metadata snapshot

Fetch the fields the watcher and bootstrap need in one call.

```bash
gh pr view <pr-number> --repo <owner>/<repo> \
  --json url,number,headRefOid,headRefName,baseRefName,state,mergeable,mergeStateStatus,mergedAt,closedAt,body,title,author
```

- `state` is one of `OPEN`, `MERGED`, `CLOSED`.
- `headRefOid` is the current head SHA — store as `head_sha` in `prs.json`.
- `headRefName` is the branch — must match the working tree's branch in bootstrap.
- `mergeable` is `MERGEABLE`, `CONFLICTING`, or `UNKNOWN` (GitHub still computing — treat as current this tick). `mergeStateStatus` carries the finer state: `DIRTY` = conflicts with base, `BEHIND` = out of date with base (no conflict), `CLEAN`/`BLOCKED`/`UNSTABLE`/`HAS_HOOKS` = current. The watcher dispatches a rebase on `CONFLICTING`/`DIRTY` **or** `BEHIND` — keeping the branch current with its base, a merge-ready gap no review or CI signal would surface.
