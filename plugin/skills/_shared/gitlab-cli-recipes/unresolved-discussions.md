# Unresolved discussions

For the watcher's dispatch trigger and the resolve-reminder stage. REST exposes resolution directly — no GraphQL needed, unlike GitHub.

```bash
glab api projects/:id/merge_requests/:iid/discussions --paginate \
  --jq '[.[] | select(.notes[0].resolvable == true) | select(any(.notes[]; .resolved == false))]'
```

A discussion is resolvable when its notes carry `resolvable == true` (diff/line threads are; the MR description and system notes are not). A thread is **unresolved** when any of its notes has `resolved == false`.

Walk each unresolved thread's `notes[]` in `created_at` order and classify by the loop marker (see [`../pr-followup-helpers/loop-signature.md`](../pr-followup-helpers/loop-signature.md)), not by `author.username` — the login is ambiguous under a shared account:

- **Addressed, awaiting resolve** — the **newest** note carries `<!-- muggle-do:bot -->`. The loop has replied and nothing newer waits. → resolve-reminder.
- **Unaddressed human comment** — the newest note lacks the marker and is newer than the thread's newest loop-marked note (or the thread has none yet). → actionable: the round should address it.
- **Not addressed** — indeterminate (e.g. no notes).

Each thread carries its `id` (the `discussion_id`) — the watcher collects this from an actionable thread to build its dispatch list and to target the resolve call later.
