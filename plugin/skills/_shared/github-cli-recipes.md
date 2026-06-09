# GitHub CLI Recipes

Reusable `gh` / `git` snippets used by `muggle-pr-followup` (watcher + bootstrap) and `/muggle-do` (address-reviews + open-prs). Each recipe is one file — load only what you need.

Skills assume a working `gh auth status`. Auth errors surface verbatim from `gh`.

## Index

| Recipe | Use case |
| :----- | :------- |
| [`pr-metadata`](github-cli-recipes/pr-metadata.md) | Snapshot PR state, head SHA, branch, conflict + `behind_by` out-of-date detection — watcher + bootstrap. |
| [`submitted-reviews`](github-cli-recipes/submitted-reviews.md) | Fetch a review by id / watcher's body-only-review check. |
| [`pr-checks`](github-cli-recipes/pr-checks.md) | Check-run rollup for the head SHA — watcher's CI poll. |
| [`line-comments-for-review`](github-cli-recipes/line-comments-for-review.md) | Pull a review's line comments — `/muggle-do` per-comment routing. |
| [`unresolved-threads`](github-cli-recipes/unresolved-threads.md) | GraphQL unresolved-thread state — watcher's dispatch trigger + resolve-reminder. |
| [`reply-line-comment`](github-cli-recipes/reply-line-comment.md) | POST a threaded reply on a line comment. |
| [`top-level-comment`](github-cli-recipes/top-level-comment.md) | POST a top-level PR comment — resolve-reminder + overflow. |
| [`push-to-branch`](github-cli-recipes/push-to-branch.md) | Push + capture new SHA after address-reviews work. |
| [`verify-working-tree`](github-cli-recipes/verify-working-tree.md) | Three checks bootstrap runs before seeding state. |
| [`pr-edit`](github-cli-recipes/pr-edit.md) | Refresh title or body when address-reviews mode flips state. |
| [`loop-user-identity`](github-cli-recipes/loop-user-identity.md) | Resolve the GitHub login of the loop user. |
