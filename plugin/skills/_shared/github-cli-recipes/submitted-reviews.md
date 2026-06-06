# Submitted reviews

Two consumers (this recipe links to neither — it is a shared primitive):

- the watcher's **body-only-review** check — a submitted review carrying a summary body but **no** line comments. Line-comment threads are dispatched from live thread state, not here.
- the address-reviews fetch of a **specific** review id.

```bash
gh api repos/<owner>/<repo>/pulls/<n>/reviews --paginate
```

Common filter:

- `submitted_at != null` (skip PENDING drafts)
- `user.login` in the resolved allow-list
- `state` in `{CHANGES_REQUESTED, COMMENTED}`, OR `APPROVED` with a non-empty body or at least one line comment

The **watcher's body-only check** adds:

- the review has **no line comments** — `gh api repos/<owner>/<repo>/pulls/<n>/reviews/<id>/comments` returns `[]`. A review with line comments is dispatched from thread state, not here.
- `id > last_seen.lastBodyReviewId`
- `id` not in `last_seen.escalated_review_ids`

A reply posted by the loop surfaces as an implicit review, but it always carries the reply as a line comment, so it can never be body-only — the body-only filter excludes it structurally, no marker check needed. Thread-level echo protection is intrinsic to the marker rule in [`unresolved-threads.md`](unresolved-threads.md).
