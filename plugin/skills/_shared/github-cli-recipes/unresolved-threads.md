# Unresolved comment threads

For the resolve-reminder stage. GraphQL only — REST does not expose `isResolved`.

```bash
gh api graphql -F owner=<owner> -F name=<repo> -F number=<n> -f query='
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 100) {
            nodes {
              databaseId
              author { login }
              body
              createdAt
            }
          }
        }
      }
    }
  }
}'
```

Filter client-side to `isResolved == false`. Walk each thread's comments in `createdAt` order and classify by the loop marker (see [`../pr-followup-helpers/loop-signature.md`](../pr-followup-helpers/loop-signature.md)), not by `author.login` — the login is ambiguous under a shared account:

- **Addressed, awaiting resolve** — the **newest** comment carries the loop marker `<!-- muggle-do:bot -->`. The loop has replied and nothing newer is waiting. → resolve-reminder.
- **Unaddressed human comment** — the newest comment lacks the marker and is newer than the thread's newest loop-marked comment (or the thread has no loop comment yet). → actionable: the round should address it.
- **Not addressed** — indeterminate (e.g. no comments).

A loop comment also cites a `<short-sha>` from `last_seen.pushed_shas[]` in its body, which tells *which* push addressed the thread.
