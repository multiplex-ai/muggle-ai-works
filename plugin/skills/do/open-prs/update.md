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

Resolve the provider once per [`../../_shared/vcs/detect-vcs.md`](../../_shared/vcs/detect-vcs.md). Wherever Steps 3–4 below edit title/description: `github` uses `gh pr edit` per [`../../_shared/vcs/github/pr-edit.md`](../../_shared/vcs/github/pr-edit.md); `gitlab` uses `glab mr update --title --description` per [`../../_shared/vcs/gitlab/mr-edit.md`](../../_shared/vcs/gitlab/mr-edit.md).

0. **Sync with the base:** `git fetch origin`, then count `behind` against the base branch recorded in `state.md`. [`../address-reviews.md`](../address-reviews.md) syncs at the top of the cycle, but stages 3–6 build, test, and run E2E in between — by the time this stage pushes, that sync is old and the PR can land behind its base.

   When `behind > 0`, run Steps 2–3 of [`../resolve-conflicts.md`](../resolve-conflicts.md) — rebase onto the base, then the verify-or-rollback gate — and force-push in Step 1, since the rebase rewrote commits the remote already has. Borrow that mode's procedure only; do not dispatch the mode itself, which force-pushes and respawns the watcher on its own, and the address-reviews orchestrator already owns the respawn for this cycle.

   If the rebase escalates — conflicts under `autoResolveConflicts=never`, or a resolution that fails verification — stop without pushing and let the orchestrator escalate. A PR sitting behind its base is recoverable: the watcher re-detects it and dispatches the rebase mode properly. A force-pushed unverified tree is not.

1. **Push:** per [`../../_shared/vcs/common/push-to-branch.md`](../../_shared/vcs/common/push-to-branch.md), with `git push --force-with-lease` when Step 0 rebased. Capture the new SHA.

2. **Append new SHA** to `last_seen.json[<key>].pushed_shas` (the resolve-reminder stage uses this to recognize threads addressed by the loop). Set `last_seen.last_pushed_sha` to the new SHA too. Both are whole-file rewrites (Read → change field → Write) per [`../../_shared/session-state-writes.md`](../../_shared/session-state-writes.md) — never the Edit tool.

3. **Refresh title if state changed.** Compare the new state against the current PR title prefix:
   - E2E now passing, current title has `[E2E FAILING]` → strip the prefix per [`../../_shared/vcs/github/pr-edit.md`](../../_shared/vcs/github/pr-edit.md).
   - E2E now failing, current title has no `[E2E FAILING]` → add the prefix.
   - Validation now ran (was unit-only/skip, now has E2E report) → strip `[UNVERIFIED]` or `[UNIT-ONLY]`.
   - Otherwise → no title change.

4. **Refresh body when validation outcome changed** — only when the `## Validation` section's content differs from what's in the body. Use the `--body-file` form in [`../../_shared/vcs/github/pr-edit.md`](../../_shared/vcs/github/pr-edit.md). Preserve `## Goal` and `## Acceptance Criteria` verbatim. Re-stamp the signature: delete the existing block from the `<!-- muggle-works:signature -->` marker to the end, then append the editable-body signature (command `/muggle-do`) as the last thing in the body per [`../../_shared/vcs/post-signature.md`](../../_shared/vcs/post-signature.md) — this keeps exactly one signature across refreshes.

5. **Visual walkthrough comment** — only when an E2E report exists. Fire [`postPRVisualWalkthrough`](../../muggle-preferences/preference-gates/postPRVisualWalkthrough.md) (PR number from `prs.json`); on skip, record `skipped (gate)` and continue. Otherwise invoke [`../../muggle-pr-visual-walkthrough/SKILL.md`](../../muggle-pr-visual-walkthrough/SKILL.md) Mode A — a fresh comment per cycle; do not edit prior walkthrough comments.

6. **Overflow comment** — same rule as forward mode: post when the walkthrough skill returns non-null `comment`, via [`../../_shared/vcs/github/top-level-comment.md`](../../_shared/vcs/github/top-level-comment.md). End the posted body with the signature line (command `/muggle-do`) per [`../../_shared/vcs/post-signature.md`](../../_shared/vcs/post-signature.md).

## Handoff

Return control to `/muggle-do`'s address-reviews orchestrator. The orchestrator runs the remaining stages (per-comment replies → resolve-reminder → respawn watcher).

## Invariants

- Branch synced with its base before the push, never after; push; new SHA appended to `pushed_shas`; title/body refreshed only on state change; walkthrough comment via Mode A.
- No `gh pr create`, no `/loop` dispatch.

## Output

**Synced with base:** `rebased onto <base> (<n> behind, force-pushed)` | `already up to date` | `skipped (autoRebase)`
**PR updated:** URL (new SHA: `<short-sha>`)
**Title refreshed:** yes | no
**Body refreshed:** yes | no
**Walkthrough comment:** posted | skipped (no report) | skipped (gate)
**Overflow comment:** posted | skipped
