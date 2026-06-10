# GitLab CLI Recipes

Reusable `glab` / `git` snippets used by `muggle-pr-followup` (watcher + bootstrap) and `/muggle-do` (address-reviews + open-prs), mirroring the `gh` set for GitLab merge requests. Each recipe is one file — load only what you need.

Skills assume a working `glab auth status`. Auth errors surface verbatim from `glab`.

The project ref `:id` is `<group>/<project>` — URL-encode it for `glab api` (`mygroup/myproj` → `mygroup%2Fmyproj`). `:iid` is the MR's per-project internal id (the `!123` number), not the global id.

## Index

| Recipe | Use case |
| :----- | :------- |
| [`mr-metadata`](gitlab-cli-recipes/mr-metadata.md) | Snapshot MR state, head SHA, branch, conflict + out-of-date detection — watcher + bootstrap. |
| [`mr-pipeline`](gitlab-cli-recipes/mr-pipeline.md) | Pipeline-job rollup for the head SHA — watcher's CI poll. |
| [`mr-discussions`](gitlab-cli-recipes/mr-discussions.md) | Fetch incoming notes/discussions — watcher's feedback poll. |
| [`unresolved-discussions`](gitlab-cli-recipes/unresolved-discussions.md) | Unresolved-discussion state — watcher's dispatch trigger + resolve-reminder. |
| [`reply-discussion`](gitlab-cli-recipes/reply-discussion.md) | POST a threaded reply on a discussion. |
| [`mr-note`](gitlab-cli-recipes/mr-note.md) | POST a top-level MR note — resolve-reminder + overflow. |
| [`resolve-discussion`](gitlab-cli-recipes/resolve-discussion.md) | Mark a discussion thread resolved. |
| [`mr-edit`](gitlab-cli-recipes/mr-edit.md) | Refresh title or description when address-reviews mode flips state. |
| [`mr-create`](gitlab-cli-recipes/mr-create.md) | Open an MR + capture its URL for handoff. |
| [`loop-user-identity`](gitlab-cli-recipes/loop-user-identity.md) | Resolve the GitLab username of the loop user. |
| [`push-to-branch`](github-cli-recipes/push-to-branch.md) | Push + capture new SHA after address-reviews work (provider-agnostic). |
| [`verify-working-tree`](github-cli-recipes/verify-working-tree.md) | Three checks bootstrap runs before seeding state (provider-agnostic). |
