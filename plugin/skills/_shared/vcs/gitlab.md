# GitLab CLI Recipes

Reusable `glab` / `git` snippets used by `muggle-pr-followup` (watcher + bootstrap) and `/muggle-do` (address-reviews + open-prs), mirroring the `gh` set for GitLab merge requests. Each recipe is one file — load only what you need.

Skills assume a working `glab auth status`. Auth errors surface verbatim from `glab`.

The project ref `:id` is `<group>/<project>` — URL-encode it for `glab api` (`mygroup/myproj` → `mygroup%2Fmyproj`). `:iid` is the MR's per-project internal id (the `!123` number), not the global id.

## Index

| Recipe | Use case |
| :----- | :------- |
| [`mr-metadata`](gitlab/mr-metadata.md) | Snapshot MR state, head SHA, branch, conflict + out-of-date detection — watcher + bootstrap. |
| [`mr-pipeline`](gitlab/mr-pipeline.md) | Pipeline-job rollup for the head SHA — watcher's CI poll. |
| [`mr-discussions`](gitlab/mr-discussions.md) | Fetch incoming notes/discussions — watcher's feedback poll. |
| [`unresolved-discussions`](gitlab/unresolved-discussions.md) | Unresolved-discussion state — watcher's dispatch trigger + resolve-reminder. |
| [`reply-discussion`](gitlab/reply-discussion.md) | POST a threaded reply on a discussion. |
| [`mr-note`](gitlab/mr-note.md) | POST a top-level MR note — resolve-reminder + overflow. |
| [`resolve-discussion`](gitlab/resolve-discussion.md) | Mark a discussion thread resolved. |
| [`mr-edit`](gitlab/mr-edit.md) | Refresh title or description when address-reviews mode flips state. |
| [`mr-create`](gitlab/mr-create.md) | Open an MR + capture its URL for handoff. |
| [`loop-user-identity`](gitlab/loop-user-identity.md) | Resolve the GitLab username of the loop user. |
| [`push-to-branch`](github/push-to-branch.md) | Signing-gated push + capture new SHA after address-reviews work (provider-agnostic). |
| [`signed-commits`](gitlab/signed-commits.md) | Never-push-unsigned rule: `%G?` preflight; no server-side signing analogue → stop and escalate. |
| [`verify-working-tree`](github/verify-working-tree.md) | Three checks bootstrap runs before seeding state (provider-agnostic). |
