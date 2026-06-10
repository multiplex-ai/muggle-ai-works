# MR discussions

Incoming feedback for the watcher's poll and the address-reviews fetch. GitLab has **no review envelope** — there is no submitted-review object grouping a summary body with line comments. Feedback arrives as individual notes, each belonging to a discussion (a thread). This recipe is the `submitted-reviews` analogue.

```bash
glab api projects/:id/merge_requests/:iid/discussions --paginate
```

Each discussion has `id` and a `notes[]` array; each note has `id`, `author.username`, `body`, `created_at`, `system` (a `true` flag marks GitLab's own activity entries — skip them).

Common filter:

- `system == false` (skip "added 2 commits", "changed the description", etc.)
- `author.username` in the resolved allow-list

Cursor: track the highest note/discussion `id` seen in `last_seen`; a note whose `id` exceeds it is new this tick. (GitLab ids are monotonic, so id ordering is reliable where `created_at` ties.)

Loop-echo skip: a note the loop itself posted carries the `<!-- muggle-do:bot -->` marker in its `body`. Classify by that marker per note, never by `author.username` alone — under a shared account the login is ambiguous. A marked note is the loop's own and must never re-trigger a cycle; an unmarked note from an allow-listed author is actionable.
