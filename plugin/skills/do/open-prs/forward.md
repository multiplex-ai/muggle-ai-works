# Open PR — forward mode

Forward pipeline's Stage 7. Invoked by `/muggle-do` after stages 1–6 of a fresh feature. Opens the change — a PR on GitHub (`gh pr create`) or an MR on GitLab (`glab mr create`), provider resolved in Step 4 — then seeds session state and dispatches the first watcher.

## Turn preamble

```
**Stage 7 — Create PR** — pushing the branch and opening the PR.
```

## Inputs

- Per-repo: name, path, branch.
- Requirements: goal, acceptance criteria.
- **Optional** E2E acceptance report from stage 6. Produced by [`../e2e-acceptance.md`](../e2e-acceptance.md); schema in [`../../muggle-pr-visual-walkthrough/SKILL.md`](../../muggle-pr-visual-walkthrough/SKILL.md).

## Per repo

0. **`autoCreatePR` gate** — apply per [`../../muggle-preferences/preference-gates/autoCreatePR.md`](../../muggle-preferences/preference-gates/autoCreatePR.md). On skip, record the reason in `result.md` and move on.

1. **Push:** `git push -u origin <branch>` in the repo directory, through the signing gate in [`../../_shared/vcs/github/push-to-branch.md`](../../_shared/vcs/github/push-to-branch.md) (indexed for both providers) — unsigned commits never leave the machine. Without local signing, follow the provider's signed-commits recipe: `github` → [`../../_shared/vcs/github/signed-commits.md`](../../_shared/vcs/github/signed-commits.md) (the branch's commits are created server-signed and the push is skipped — the remote already has them), `gitlab` → [`../../_shared/vcs/gitlab/signed-commits.md`](../../_shared/vcs/gitlab/signed-commits.md) (stop and escalate — no server-side signing).

2. **Title** (under 70 chars):
   - E2E report exists and has failures → `[E2E FAILING] <goal>`
   - No E2E report (validation was `unit-only` or `skip`) → `[UNVERIFIED] <goal>` or `[UNIT-ONLY] <goal>` to match the validation strategy
   - Otherwise → `<goal>`

3. **Body** — assemble in order:
   - `## Goal` — from requirements.
   - `## Acceptance Criteria` — bulleted; omit if empty.
   - `## Changes` — summary of what changed in this repo.
   - `## Validation` — one line: link to E2E report, `unit-only`, or `skip — <reason>`.
   - **Walkthrough block** — only when an E2E report exists. Fire [`postPRVisualWalkthrough`](../../muggle-preferences/preference-gates/postPRVisualWalkthrough.md); on skip, omit this block. Otherwise invoke [`../../muggle-pr-visual-walkthrough/SKILL.md`](../../muggle-pr-visual-walkthrough/SKILL.md) Mode B and embed the returned `body` verbatim. No report → skip the block.

4. **Create:** resolve the provider per [`../../_shared/vcs/detect-vcs.md`](../../_shared/vcs/detect-vcs.md).
   - `github` → `gh pr create --title "..." --body "..." --head <branch>`. Capture the PR URL and number.
   - `gitlab` → open the change via [`../../_shared/vcs/gitlab/mr-create.md`](../../_shared/vcs/gitlab/mr-create.md): `glab mr create --source-branch <branch> --target-branch <base> --title "..." --description "..."`. Capture the MR URL and iid.

5. **Overflow comment:** if the walkthrough skill returned a non-null `comment`, post it once using the provider resolved in Step 4 — `github` per [`../../_shared/vcs/github/top-level-comment.md`](../../_shared/vcs/github/top-level-comment.md), `gitlab` per [`../../_shared/vcs/gitlab/mr-note.md`](../../_shared/vcs/gitlab/mr-note.md). Never post when `comment` is `null`.

## Stage 8 handoff

After every repo is processed, build the watcher manifest and dispatch one watcher loop per opened PR. The dispatches are the LAST action this stage takes.

Write `~/.muggle-ai/muggle-do/sessions/<slug>/prs.json` per [`../../muggle-pr-followup/state-schemas.md`](../../muggle-pr-followup/state-schemas.md#prsjson):

```json
[{ "repo": "owner/repo", "number": 142, "url": "...", "head_sha": "...", "state": "open" }]
```

Seed `~/.muggle-ai/muggle-do/sessions/<slug>/last_seen.json` per [`../../muggle-pr-followup/state-schemas.md`](../../muggle-pr-followup/state-schemas.md#last_seenjson) — empty-watermark shape with `pushed_shas: []`. Forward mode never has prior reviews to skip, so `lastBodyReviewId: 0`.

**Do not** seed `cycle.json` or `requirements.md`. The watcher is a dumb pipe; `/muggle-do` reads reviews off GitHub.

For each entry in `prs.json`, dispatch its watcher:
```
/loop 1m /muggle:muggle-pr-followup <slug> <pr-number>
```

If `prs.json` is empty, **do not dispatch** — record the reason in `result.md` and exit.

## Invariants

- PR creation per non-skipped repo; walkthrough block via Mode B; `prs.json`+`last_seen.json` seeded (no `cycle.json`, no `requirements.md`); `/loop` dispatch is the last action.

## Output

**PRs Created:** repo → URL
**Skipped:** repo → reason (when `autoCreatePR` short-circuited)
**Overflow comments posted:** repo → PR #
**Stage 8:** `Watching <N> PR(s) — one /loop 1m /muggle:muggle-pr-followup <slug> <pr#> per PR` | `No PRs to watch — stage 8 not dispatched`
**Errors:** repo → message

## Post-merge cleanup

Gated by `autoCleanup`. Triggered when the watcher's terminal tick observes the merge and dispatches `/muggle-do`'s cleanup directive ([`../cleanup.md`](../cleanup.md)) — never from this stage. See [`../../_shared/post-merge-cleanup.md`](../../_shared/post-merge-cleanup.md).

Append one short reminder tied to the gate value:

- `always` → `Once merged, I'll run the cleanup sequence automatically.`
- `never` → omit.
- `ask` / absent → `Once merged, I'll check with you about cleanup.`

Regardless of the gate, also append: `Once it's merged or closed, I'll move to the next plan item — or ask where to go next if there's no plan.`
