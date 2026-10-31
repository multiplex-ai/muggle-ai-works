# Open PR — forward mode

The forward pipeline's PR stages, which run on either side of Stage 6. **Stage 5.5** opens the change — a PR on GitHub (`gh pr create`) or an MR on GitLab (`glab mr create`), provider resolved in Step 5 — as soon as unit tests pass, before any browser run. **Stage 7** settles that run's result on it, then seeds session state and arms the first watch.

The PR goes up first because opening it needs nothing from the run: CI and reviewers start on the diff while E2E runs, and the run's [PR progress](../../_shared/dev-loop/run.md#pr-progress) fills the PR's walkthrough comment case by case. The walkthrough check stays red until Stage 7 settles that comment, so an open PR never passes as tested before its run lands.

## Turn preambles

```
**Stage 5.5 — Open PR** — pushing the branch and opening the PR before E2E.
```

```
**Stage 7 — Report on the PR** — settling the walkthrough with the E2E result.
```

## Inputs

- Per-repo: name, path, branch.
- Requirements: goal, acceptance criteria.
- The validation strategy from `state.md` — Stage 5.5 titles the PR from it, since no run has happened yet.
- Stage 7 only: the **optional** E2E acceptance report from Stage 6. Produced by [`../e2e-acceptance.md`](../e2e-acceptance.md) — inline, or returned by this change's background acceptance-tester ([`../background-e2e.md`](../background-e2e.md)); schema in [`../../muggle-pr-visual-walkthrough/SKILL.md`](../../muggle-pr-visual-walkthrough/SKILL.md). Only this change's own report: a sibling change's run never settles this PR.

## Wave cycles

`state.md` records `Wave: on` → follow the Stage 5.5 and Stage 7 ordering in [`../wave-e2e.md`](../wave-e2e.md): open every wave PR before Stage 6 starts, add the `## Wave` section to each body, give every member the same title prefix, and settle each PR's walkthrough with the same report (Mode A, PR number + repo passed explicitly). The per-repo steps below run with those changes.

## Stage 5.5 — open the PR

Per repo:

0. **`autoCreatePR` gate** — apply per [`../../muggle-preferences/preference-gates/autoCreatePR.md`](../../muggle-preferences/preference-gates/autoCreatePR.md), its explicit-request rule included. On skip, record the reason in `result.md` and move on; Stage 6 still runs.

1. **Sync with the base:** run [`../../_shared/sync-branch-with-base.md`](../../_shared/sync-branch-with-base.md) with `base` set to the PR target recorded in `state.md` — gated by [`autoRebase`](../../muggle-preferences/preference-gates/autoRebase.md), fires only when `behind > 0`. The branch is not on the remote yet, so the rebase lands without a force-push. Sync here rather than leaving it to Stage 6: a `unit-only` or `skip` run never reaches the E2E stage's sync at all, and on a run that does, the PR opens before that sync. If the sync escalates — conflicts under `autoResolveConflicts=never`, or a resolution that fails the verify-or-rollback gate — stop and report; never open a PR on a tree that did not verify.

1.5. **CI check:** GitHub repos only, gated by [`autoInstallCiWorkflow`](../../muggle-preferences/preference-gates/autoInstallCiWorkflow.md).
   - **Tree lacks `.github/workflows/muggle-walkthrough.yml`** — on `always`, or `CI check: add` recorded by pre-flight, run `muggle ci-install` in the working tree and commit the workflow as `ci: add the Muggle E2E walkthrough check`, so it ships in this PR. On `never` or `CI check: skip`, leave CI alone.
   - **Tree has it** — unless the gate resolves to `never`, run `muggle ci-install` without `--force`. It replaces only an unedited copy an earlier release wrote and leaves a current or edited one alone, so nothing needs asking. When it reports `Updated`, commit the file as `ci: update the Muggle E2E walkthrough check`.

2. **Push:** Execute per [`../../_shared/vcs/common/push-to-branch.md`](../../_shared/vcs/common/push-to-branch.md) — the tool-agnostic instruction for pushing commits (handles the signing gate and directs to provider-specific recipes).

3. **Title** (under 70 chars), from the validation strategy:
   - `unit-only` → `[UNIT-ONLY] <goal>`
   - `skip` → `[UNVERIFIED] <goal>`
   - Otherwise → `<goal>`. Stage 7 adds `[E2E FAILING]` if the run fails.

4. **Body** — assemble in order:
   - `## Goal` — from requirements.
   - `## Acceptance Criteria` — bulleted; omit if empty.
   - `## Changes` — summary of what changed in this repo.
   - `## Validation` — one line naming the strategy: `local-e2e — results in the walkthrough comment`, `unit-only`, or `skip — <reason>`. Stage 7 adds a report's **Deliverables** tables below it.
   - The walkthrough does **not** go in the body. It settles the PR's designated walkthrough comment in Stage 7, so a rerun updates one comment instead of rewriting the description.
   - **Signature** — write the assembled body to a file and sign it with `--command /muggle-do --mode editable` per [`../../_shared/vcs/post-signature.md`](../../_shared/vcs/post-signature.md). `editable` is the mode a description carries so later refreshes replace it instead of stacking.

5. **Create:** resolve the provider per [`../../_shared/vcs/detect-vcs.md`](../../_shared/vcs/detect-vcs.md).
   - `github` → `gh pr create --title "..." --body-file <signed-file> --head <branch>`, passing the file signed in Step 4. Capture the PR URL and number.
   - `gitlab` → open the change via [`../../_shared/vcs/gitlab/mr-create.md`](../../_shared/vcs/gitlab/mr-create.md): `glab mr create --source-branch <branch> --target-branch <base> --title "..." --description "..."`. Capture the MR URL and iid.

   A create that fails ends the cycle for that repo: report it under **Errors** and run no E2E for it, since the run would have no PR to settle.

## Stage 7 — report on the PR

Runs once Stage 6 has recorded this change's verdict; a Stage 6 readiness halt never reaches it. Per repo, using the provider resolved in Stage 5.5:

1. **Push the tested head.** Stage 6's readiness check syncs the worktree onto the latest base, so a base that moved after Stage 5.5 leaves HEAD — the commit the run tested — rebased past what the PR shows. When HEAD differs from the PR's head, push it per [`../../_shared/vcs/common/push-to-branch.md`](../../_shared/vcs/common/push-to-branch.md) with `git push --force-with-lease`, since the rebase rewrote commits the remote already has. Never sync again here: a rebase after the run would put a tree the run never tested under its walkthrough.

2. **Title:** a report with failures → retitle `[E2E FAILING] <goal>` per [`../../_shared/vcs/github/pr-edit.md`](../../_shared/vcs/github/pr-edit.md) (`gitlab`: [`../../_shared/vcs/gitlab/mr-edit.md`](../../_shared/vcs/gitlab/mr-edit.md)). Otherwise the Stage 5.5 title stands.

3. **Body:** a report with a **Deliverables** block → add its tables below `## Validation` per [`../../_shared/deliverable-categories.md`](../../_shared/deliverable-categories.md#evidence-on-the-pr), with the `--body-file` form of the same edit recipe. Delete the old signature block from the `<!-- muggle-works:signature -->` marker to the end and re-sign the body as Stage 5.5 Step 4 did, so it keeps exactly one signature.

4. **Settle the designated walkthrough comment.** Creating the PR reserved one comment for the walkthrough, marked `muggle-pr-walkthrough`; the run's PR progress fills it with per-case rows, and the PR's walkthrough check fails until it is settled.
   - E2E report exists → fire [`postPRVisualWalkthrough`](../../muggle-preferences/preference-gates/postPRVisualWalkthrough.md); on skip, leave the comment to the gate's own skip record. Otherwise invoke [`../../muggle-pr-visual-walkthrough/SKILL.md`](../../muggle-pr-visual-walkthrough/SKILL.md) Mode A with the PR number and repo passed explicitly — it replaces the progress rows with the walkthrough in place. Explicit because a session carrying several changes may sit in another change's worktree, where the current branch's PR is the wrong one.
   - No E2E report (validation was `unit-only` or `skip`), a `SKIPPED` report, or a report whose browser part was skipped (a `**Browser skip:**` line, or deliverable entries and no test cases) → the skip Stage 6 declared from this PR's worktree settles it. A background run returns its skip code instead of declaring it: declare it now, from this PR's worktree, with the same code — `echo "MUGGLE_E2E_SKIP: <CODE>: <detail>"`, codes per [`../e2e-acceptance.md`](../e2e-acceptance.md). An accepted code settles only the PRs of that worktree's change — the PRs opened from it and its checked-out branch's PR; a free-text reason is rejected and leaves it unsettled. A PR whose title says `[UNIT-ONLY]` still owes reviewers the why. The write runs detached, so confirm it landed: the walkthrough Stop gate holds the turn while the PR still shows the placeholder, and its block names a foreground command that prints `{"settled":true}` once the PR reads back the skip — run it, never a hand-written PATCH.

5. **Overflow comment:** if the walkthrough skill returned a non-null `comment`, post it once — `github` per [`../../_shared/vcs/github/top-level-comment.md`](../../_shared/vcs/github/top-level-comment.md), `gitlab` per [`../../_shared/vcs/gitlab/mr-note.md`](../../_shared/vcs/gitlab/mr-note.md). End the posted body with the signature line (command `/muggle-do`) per [`../../_shared/vcs/post-signature.md`](../../_shared/vcs/post-signature.md). Never post when `comment` is `null`.

## Stage 7.5 gate

The E2E repair loop ([`../e2e-repair.md`](../e2e-repair.md)) runs once Stage 7 has settled the walkthrough, and before the handoff below. Proceed only on its `green`, `waived`, or `iteration-cap` clearance — handing a red run to a watcher puts it in front of reviewers with nobody looking at the failures. When Stage 6 recorded `PASS` or `SKIPPED` the loop clears in its own Step 0 at no cost, so there is never a reason to skip it.

## Stage 8 handoff

After every repo is processed and Stage 7.5 has cleared, build the watcher manifest and arm one watch per opened PR. The arms are the LAST action this stage takes.

Write `~/.muggle-ai/muggle-do/sessions/<slug>/prs.json` per [`../../muggle-pr-followup/state-schemas.md`](../../muggle-pr-followup/state-schemas.md#prsjson):

```json
[{ "repo": "owner/repo", "number": 142, "url": "...", "head_sha": "...", "state": "open" }]
```

Seed `~/.muggle-ai/muggle-do/sessions/<slug>/last_seen.json` per [`../../muggle-pr-followup/state-schemas.md`](../../muggle-pr-followup/state-schemas.md#last_seenjson) — empty-watermark shape with `pushed_shas: []`. Forward mode never has prior reviews to skip, so `lastBodyReviewId: 0`.

**Do not** seed `cycle.json` or `requirements.md`. The watcher is a dumb pipe; `/muggle-do` reads reviews off GitHub.

For each entry in `prs.json`, arm its watch per [`../../muggle-pr-followup/arm-watcher.md`](../../muggle-pr-followup/arm-watcher.md) — the same procedure [`../respawn-watcher.md`](../respawn-watcher.md) settles every later watch with: one drain tick, the watermark seeded from it, then one persistent labeled monitor. Never a recurring `/loop` cron — every cron fire is a model turn, while the monitor polls token-free. The PR counts as watched only once that monitor's loop is running; a seeded slot alone is not a watch.

If `prs.json` is empty, **do not arm** — record the reason in `result.md` and exit.

## Invariants

- Branch synced with its base before the push, never after; PR opened per non-skipped repo before Stage 6 starts; the tested head is the PR's head before its walkthrough settles; designated walkthrough comment settled via Mode A, or its skip reason stated; `prs.json`+`last_seen.json` seeded (no `cycle.json`, no `requirements.md`); Stage 7.5 cleared before arming; arming per `arm-watcher.md` is the last action.

## Output

**Synced with base:** repo → `rebased onto <base> (<n> behind)` | `already up to date` | `skipped (autoRebase)`
**PRs Created:** repo → URL
**Skipped:** repo → reason (when `autoCreatePR` short-circuited)
**Tested head:** repo → `already the PR head` | `force-pushed <short-sha> (Stage 6 synced onto a moved base)`
**Overflow comments posted:** repo → PR #
**Stage 7.5:** `green` | `waived — <reason>` | `iteration-cap`
**Stage 8:** `Watching <N> PR(s) — one watch loop per PR, armed per arm-watcher.md` | `No PRs to watch — stage 8 not armed`
**Errors:** repo → message

## Post-merge cleanup

Gated by `autoCleanup`. Triggered when the watcher's terminal tick observes the merge and dispatches `/muggle-do`'s cleanup directive ([`../cleanup.md`](../cleanup.md)) — never from this stage. See [`../../_shared/post-merge-cleanup.md`](../../_shared/post-merge-cleanup.md).

Append one short reminder tied to the gate value:

- `always` → `Once merged, I'll run the cleanup sequence automatically.`
- `never` → omit.
- `ask` / absent → `Once merged, I'll check with you about cleanup.`

Regardless of the gate, also append: `Once it's merged or closed, I'll move to the next plan item — or ask where to go next if there's no plan.`
