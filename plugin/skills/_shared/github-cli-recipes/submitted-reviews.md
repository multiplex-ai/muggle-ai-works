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
- **Not a loop echo.** `POST /pulls/<n>/comments/<id>/replies` creates an implicit review whose comments all have `in_reply_to_id` set. Fetch each candidate review's comments via `gh api repos/<owner>/<repo>/pulls/<n>/reviews/<id>/comments` and drop the review **only if every comment is a reply (`in_reply_to_id != null`) and carries the loop marker `<!-- muggle-do:bot -->`** (see [`../pr-followup-helpers/loop-signature.md`](../pr-followup-helpers/loop-signature.md)). A reply-only wrapper with any comment **lacking** the marker is a human follow-up — keep it; the round addresses it. Matching the marker, not structure, is what skips the loop's own replies (posted under the author's identity in single-account workflows) without dropping genuine follow-ups.
