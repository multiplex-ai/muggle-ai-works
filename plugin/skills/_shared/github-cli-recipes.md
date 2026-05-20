# GitHub CLI Recipes

Reusable `gh` and `git` snippets used by `muggle-pr-followup` (watcher + bootstrap) and `/muggle-do` (address-reviews mode + open-prs). Each recipe is the canonical form — when adjusting flags, update here and citing call-sites point back.

## Authentication assumed

These snippets assume the user has a working `gh auth status`. Skills do not authenticate inside recipes; if a call fails with an auth error, surface the underlying `gh` message verbatim.

## Recipes

### PR metadata snapshot

Fetch the fields the watcher and bootstrap need in one call.

```bash
gh pr view <pr-number> --repo <owner>/<repo> \
  --json url,number,headRefOid,headRefName,baseRefName,state,mergedAt,closedAt,body,title,author
```

- `state` is one of `OPEN`, `MERGED`, `CLOSED`.
- `headRefOid` is the current head SHA — store this as `head_sha` in the session's `prs.json`.
- `headRefName` is the branch — must match the working tree's branch in bootstrap.

### Submitted reviews past a cursor

Fetch new reviews for the watcher's poll. Filters and the cursor comparison are applied by the caller.

```bash
gh api repos/<owner>/<repo>/pulls/<n>/reviews --paginate
```

The watcher filters the result client-side:

- `submitted_at != null` (skip PENDING drafts)
- `id > last_seen.reviewId`
- `id` not in `last_seen.escalated_review_ids`
- `user.login` in the resolved allow-list
- `state` in `{CHANGES_REQUESTED, COMMENTED}`, OR `APPROVED` with a non-empty body or at least one line comment

### Line comments for a specific review

For per-comment reply routing in `/muggle-do`.

```bash
gh api repos/<owner>/<repo>/pulls/<n>/comments --paginate \
  --jq '[.[] | select(.pull_request_review_id == <review-id>)]'
```

### Unresolved comment threads on a PR

For the resolve-reminder stage. GraphQL is the only path; the REST endpoint does not expose `isResolved`.

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

Filter client-side to `isResolved == false`. The thread is classified by inspecting its `comments`:

- **Addressed by loop** — at least one comment authored by the loop user citing a SHA in `last_seen.pushed_shas[]`.
- **Addressed by human** — at least one comment authored by a non-loop user after the original comment, and no addressed-by-loop signal.
- **Not addressed** — otherwise.

### Reply to a line comment (threaded)

Used by `/muggle-do` per-comment inline replies.

```bash
gh api --method POST \
  -H "Accept: application/vnd.github+json" \
  repos/<owner>/<repo>/pulls/<n>/comments/<comment-id>/replies \
  -f body="<reply-text>"
```

### Top-level PR comment (for resolve-reminder)

```bash
gh pr comment <pr-number> --repo <owner>/<repo> --body "<text>"
```

### Push to the PR branch

After the cycle's work in `/muggle-do` address-reviews mode.

```bash
git -C <repo-path> push origin <head-ref-name>
```

Capture the new SHA after push:

```bash
git -C <repo-path> rev-parse HEAD
```

Append this SHA to `last_seen.pushed_shas[]` so the resolve-reminder stage can recognize it.

### Verify working tree matches the PR's repo

Used by bootstrap's environment check. Two assertions:

```bash
# 1. cwd is a git working tree
git rev-parse --show-toplevel

# 2. remote matches the PR's repo (handles both ssh and https forms)
git remote get-url origin
```

The remote URL must resolve to `<owner>/<repo>`. Accept any of:

- `https://github.com/<owner>/<repo>` (with or without trailing `.git`)
- `git@github.com:<owner>/<repo>` (with or without trailing `.git`)
- `ssh://git@github.com/<owner>/<repo>` (with or without trailing `.git`)

### Verify the PR's branch is checked out

```bash
git rev-parse --abbrev-ref HEAD
```

Must equal the PR's `headRefName`. Mismatch → bootstrap aborts with the `gh pr checkout` snippet from `output-templates.md`.

### Refresh the PR's title

For `open-prs.md` in address-reviews mode when E2E flips from failing to passing (or vice versa).

```bash
gh pr edit <pr-number> --repo <owner>/<repo> --title "<new-title>"
```

### Refresh the PR's body

```bash
gh pr edit <pr-number> --repo <owner>/<repo> --body-file <file>
```

## Identifying the loop user

Some recipes (resolve-reminder thread classification, reply attribution) need to know "is this comment from the loop?". The loop user is the GitHub identity that owns the currently-authenticated `gh` token:

```bash
gh api user --jq '.login'
```

Cache the result per session in `state.md` under `loop_user:`; re-resolve on first invocation only.
