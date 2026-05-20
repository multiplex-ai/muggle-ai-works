# Submitted reviews past a cursor

For the watcher's poll and the address-reviews fetch.

```bash
gh api repos/<owner>/<repo>/pulls/<n>/reviews --paginate
```

Filter client-side:

- `submitted_at != null` (skip PENDING drafts)
- `id > last_seen.reviewId`
- `id` not in `last_seen.escalated_review_ids`
- `user.login` in the resolved allow-list
- `state` in `{CHANGES_REQUESTED, COMMENTED}`, OR `APPROVED` with a non-empty body or at least one line comment
