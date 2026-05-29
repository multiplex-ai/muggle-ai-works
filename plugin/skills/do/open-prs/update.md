# Update PR — address-reviews mode

Invoked by `/muggle-do`'s address-reviews orchestrator after stages 3–6 ran on the existing PR. The PR already exists; this stage pushes the branch, refreshes title/description if state changed, and posts a fresh walkthrough.

Does **not** create a PR, seed session state, or dispatch a watcher (`/muggle-do` respawns the watcher at the end of its address-reviews cycle).

## Turn preamble

```
**Stage 7 — Update PR** — pushing the branch and refreshing the PR.
```

## Inputs

- Per-repo: path, branch (head ref name).
- The existing PR URL + number from `~/.muggle-ai/muggle-do/sessions/<slug>/prs.json`.
- **Optional** E2E acceptance report from stage 6. Produced by [`../e2e-acceptance.md`](../e2e-acceptance.md); schema in [`../../muggle-pr-visual-walkthrough/SKILL.md`](../../muggle-pr-visual-walkthrough/SKILL.md).

## Procedure

Skip `autoCreatePR` (it gates creation, not update). The PR's title is left intact unless state changed in Step 3.

1. **Push:** per [`../../_shared/github-cli-recipes/push-to-branch.md`](../../_shared/github-cli-recipes/push-to-branch.md). Capture the new SHA.

2. **Append new SHA** to `last_seen.json[<key>].pushed_shas` (the resolve-reminder stage uses this to recognize threads addressed by the loop). Set `last_seen.last_pushed_sha` to the new SHA too.

3. **Refresh title if state changed.** Compare the new state against the current PR title prefix:
   - E2E now passing, current title has `[E2E FAILING]` → strip the prefix per [`../../_shared/github-cli-recipes/pr-edit.md`](../../_shared/github-cli-recipes/pr-edit.md).
   - E2E now failing, current title has no `[E2E FAILING]` → add the prefix.
   - Validation now ran (was unit-only/skip, now has E2E report) → strip `[UNVERIFIED]` or `[UNIT-ONLY]`.
   - Otherwise → no title change.

4. **Refresh body when validation outcome changed** — only when the `## Validation` section's content differs from what's in the body. Use the `--body-file` form in [`../../_shared/github-cli-recipes/pr-edit.md`](../../_shared/github-cli-recipes/pr-edit.md). Preserve `## Goal` and `## Acceptance Criteria` verbatim.

5. **Visual walkthrough comment** — if an E2E report exists, invoke [`../../muggle-pr-visual-walkthrough/SKILL.md`](../../muggle-pr-visual-walkthrough/SKILL.md) Mode A. Always a fresh comment per cycle; do not edit prior walkthrough comments.

6. **Overflow comment** — same rule as forward mode: post when the walkthrough skill returns non-null `comment`, via [`../../_shared/github-cli-recipes/top-level-comment.md`](../../_shared/github-cli-recipes/top-level-comment.md).

## Handoff

Return control to `/muggle-do`'s address-reviews orchestrator. The orchestrator runs the remaining stages (per-comment replies → resolve-reminder → respawn watcher).

## Invariants

- Push; new SHA appended to `pushed_shas`; title/body refreshed only on state change; walkthrough comment via Mode A.
- No `gh pr create`, no `/loop` dispatch.

## Output

**PR updated:** URL (new SHA: `<short-sha>`)
**Title refreshed:** yes | no
**Body refreshed:** yes | no
**Walkthrough comment:** posted | skipped (no report)
**Overflow comment:** posted | skipped
