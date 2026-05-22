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
- **Not a reply-wrapper.** `POST /pulls/<n>/comments/<id>/replies` creates an implicit review whose comments all have `in_reply_to_id` set. Fetch each candidate review's comments via `gh api repos/<owner>/<repo>/pulls/<n>/reviews/<id>/comments` and drop the review if every comment has a non-null `in_reply_to_id` (no new top-level critique). Without this clause, the loop's own threaded replies — submitted under the PR author's identity in single-account workflows — pass the allow-list and re-dispatch `/muggle-do` on a no-op cycle.
