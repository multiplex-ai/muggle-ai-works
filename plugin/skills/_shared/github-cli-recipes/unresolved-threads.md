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

Filter client-side to `isResolved == false`. Classify each thread by inspecting its comments:

- **Addressed by loop** — at least one comment authored by the loop user citing a SHA in `last_seen.pushed_shas[]`.
- **Addressed by human** — at least one comment authored by a non-loop user after the original, and no addressed-by-loop signal.
- **Not addressed** — otherwise.
