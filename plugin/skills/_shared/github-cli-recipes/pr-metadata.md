# PR metadata snapshot

Fetch the fields the watcher and bootstrap need.

```bash
gh pr view <pr-number> --repo <owner>/<repo> \
  --json url,number,headRefOid,headRefName,baseRefName,state,mergeable,mergeStateStatus,mergedAt,closedAt,body,title,author
```

- `state` is one of `OPEN`, `MERGED`, `CLOSED`.
- `headRefOid` is the current head SHA — store as `head_sha` in `prs.json`.
- `headRefName` is the branch — must match the working tree's branch in bootstrap.
- `mergeable` is `MERGEABLE`, `CONFLICTING`, or `UNKNOWN` (GitHub still computing — treat as not-conflicting this tick). The watcher's **conflict** signal is `mergeable == CONFLICTING` (corroborated by `mergeStateStatus == DIRTY`).

## Behind-by (out-of-date detection)

`mergeStateStatus == BEHIND` is **not** a reliable out-of-date signal. GitHub collapses merge state into one value with precedence — `DIRTY` (conflict) and `BLOCKED` (missing required review, pending/failing required check) outrank `BEHIND` and mask it, and `BEHIND` surfaces *at all* only when the base enforces "require branches up to date." So a PR that is genuinely behind **and** awaiting review reports `BLOCKED`; `BEHIND` never shows, and its staleness goes unseen.

Detect out-of-date straight from commit ancestry instead — independent of merge-state precedence, review state, and branch protection:

```bash
gh api repos/<owner>/<repo>/compare/<baseRefName>...<head_sha> --jq '.behind_by'
```

`behind_by > 0` ⇒ the head is missing that many base commits ⇒ out of date. `0` ⇒ current with base. (`ahead_by` counts the head's own commits — ignore it.) This is the watcher's out-of-date trigger; it is exact even while `mergeable == UNKNOWN`.
