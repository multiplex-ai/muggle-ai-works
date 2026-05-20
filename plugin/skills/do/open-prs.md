# Create-or-Update PR Agent (Stage 7)

Open a pull request when one does not yet exist for the branch, or update the existing PR (push, refresh title/description, post a fresh walkthrough) when running in `/muggle-do`'s **address-reviews mode**. Honor preference gates. In forward mode, hand off to the watcher loop once done.

## Modes

This stage runs in one of two modes, set by the `/muggle-do` invocation that called it:

- **Forward mode** — invoked from the forward pipeline (stages 1–6 just completed for a brand-new PR). Creates the PR via `gh pr create`. Seeds session state and dispatches the first watcher. This is the original behavior.
- **Address-reviews mode** — invoked from `/muggle-do`'s address-reviews flow (the watcher dispatched `/muggle-do` after seeing new reviews). The PR already exists. Pushes the branch, refreshes title/description if state changed, posts a fresh walkthrough comment. Does **not** create a PR, does **not** seed state, does **not** dispatch a new watcher (`/muggle-do` will respawn the watcher at the end of its cycle).

## Turn preamble

Forward mode:
```
**Stage 7 — Create PR** — pushing the branch and opening the PR.
```

Address-reviews mode:
```
**Stage 7 — Update PR** — pushing the branch and refreshing the PR.
```

## Inputs

- Per-repo: name, path, branch.
- Requirements: goal, acceptance criteria. (Forward mode only — in address-reviews mode the reviews-as-amendments take this role.)
- **Optional** E2E acceptance report from stage 6 — only present when validation ran. Produced by [`e2e-acceptance.md`](e2e-acceptance.md); schema is canonical in [`muggle-pr-visual-walkthrough/SKILL.md`](../muggle-pr-visual-walkthrough/SKILL.md).
- **Address-reviews mode only:** the existing PR URL + number from `.muggle-do/sessions/<slug>/prs.json`.

## Forward mode — per repo

0. **`autoCreatePR` gate** — apply per [`../muggle-preferences/preference-gates/autoCreatePR.md`](../muggle-preferences/preference-gates/autoCreatePR.md). On skip, record the reason in `result.md` and move on.

1. **Push:** `git push -u origin <branch>` in the repo directory.

2. **Title** (under 70 chars):
   - E2E report exists and has failures → `[E2E FAILING] <goal>`
   - No E2E report at all (validation was `unit-only` or `skip`) → `[UNVERIFIED] <goal>` or `[UNIT-ONLY] <goal>` to match the validation strategy
   - Otherwise → `<goal>`

3. **Body** — assemble in order:
   - `## Goal` — from requirements.
   - `## Acceptance Criteria` — bulleted; omit section if empty.
   - `## Changes` — summary of what changed in this repo.
   - `## Validation` — one line: link to E2E report, or `unit-only`, or `skip — <reason>`.
   - **If an E2E report exists,** invoke [`muggle-pr-visual-walkthrough`](../muggle-pr-visual-walkthrough/SKILL.md) Mode B to render the walkthrough block. Embed the returned `body` verbatim. If no report, skip this block entirely.

4. **Create:** `gh pr create --title "..." --body "..." --head <branch>`. Capture the PR URL and number.

5. **Overflow comment:** if the walkthrough skill returned a non-null `comment`, post it once via the "Top-level PR comment" recipe in [`../_shared/github-cli-recipes.md`](../_shared/github-cli-recipes.md#top-level-pr-comment-for-resolve-reminder). Never post when `comment` is `null`.

## Address-reviews mode — per repo

The PR exists. Skip `autoCreatePR` (it gates creation, not update). Skip Title generation step (use the existing title; only refresh if state changed — see Step 3 below).

1. **Push:** use the "Push to the PR branch" recipe from [`../_shared/github-cli-recipes.md`](../_shared/github-cli-recipes.md#push-to-the-pr-branch). Capture the new SHA.

2. **Append new SHA** to `last_seen.json[<key>].pushed_shas` (the resolve-reminder stage uses this to recognize threads addressed by the loop). Set `last_seen.last_pushed_sha` to the new SHA as well.

3. **Refresh title if state changed.** Compare the new state against the current PR title prefix:
   - E2E now passing, current title has `[E2E FAILING]` → strip the prefix via "Refresh the PR's title" recipe.
   - E2E now failing, current title has no `[E2E FAILING]` → add the prefix.
   - Validation now ran (was unit-only/skip, now has E2E report) → strip `[UNVERIFIED]` or `[UNIT-ONLY]`.
   - Otherwise → no title change.

4. **Refresh body when validation outcome changed** — only when the `## Validation` section's content differs from what's currently in the body. Use "Refresh the PR's body" recipe. Do not rewrite unrelated sections (`## Goal`, `## Acceptance Criteria`); preserve them verbatim.

5. **Visual walkthrough comment** — if an E2E report exists, invoke [`muggle-pr-visual-walkthrough`](../muggle-pr-visual-walkthrough/SKILL.md) Mode A (post as a fresh comment, not embedded in body). Always a fresh comment per cycle; do not edit prior walkthrough comments.

6. **Overflow comment** — same rule as forward mode: post when the walkthrough skill returns non-null `comment`.

## Stage 8 handoff (forward mode only)

After every repo is processed in forward mode, build the watcher manifest and dispatch one watcher loop per opened PR. The dispatches are the LAST action this stage takes — once they fire, the original session is free.

Write `.muggle-do/sessions/<slug>/prs.json` per [`../muggle-pr-followup/state-schemas.md`](../muggle-pr-followup/state-schemas.md#prsjson):

```json
[{ "repo": "owner/repo", "number": 142, "url": "...", "head_sha": "...", "state": "open" }]
```

Seed `.muggle-do/sessions/<slug>/last_seen.json` per [`../muggle-pr-followup/state-schemas.md`](../muggle-pr-followup/state-schemas.md#last_seenjson) — empty cursor shape with `pushed_shas: []`. Forward mode never has prior reviews to skip, so `reviewId: 0`.

**Do not** seed `cycle.json` or `requirements.md` into the session slot. Those files no longer exist under the watcher-handoff shape. The watcher is a dumb pipe; `/muggle-do` reads reviews off GitHub each invocation.

For each entry in `prs.json`, dispatch its own watcher as the final action:
```
/loop 1m /muggle:muggle-pr-followup <slug> <pr-number>
```

If `prs.json` is empty (all repos skipped, or all PR creations failed), **do not dispatch** — record the reason in `result.md` and exit.

## Address-reviews mode handoff

This mode does **not** dispatch a watcher itself. After Step 6 above, return control to `/muggle-do`, which runs the next stages of its address-reviews flow (per-comment inline replies → resolve-reminder → respawn watcher). The respawn is `/muggle-do`'s responsibility, not this stage's.

## Self-check before exit

Forward mode:

- [ ] Every non-skipped repo got `gh pr create` to succeed.
- [ ] When an E2E report existed, the walkthrough block was rendered via Mode B (not hand-written).
- [ ] Overflow `comment` was posted only when non-null.
- [ ] `prs.json` and `last_seen.json` reflect the PRs actually opened (no `cycle.json`, no `requirements.md`).
- [ ] If `prs.json` is non-empty, the `/loop` dispatch was the last action.

Address-reviews mode:

- [ ] Push succeeded and the new SHA was appended to `last_seen.pushed_shas`.
- [ ] Title/body refresh only ran when state changed.
- [ ] Walkthrough Mode A produced a fresh comment when an E2E report was present.
- [ ] No `gh pr create` ran (the PR already exists).
- [ ] No `/loop` dispatch ran (`/muggle-do` owns the respawn after subsequent stages).

## Output

Forward mode:

**PRs Created:** repo → URL
**Skipped:** repo → reason (when `autoCreatePR` short-circuited)
**Overflow comments posted:** repo → PR #
**Stage 8:** `Watching <N> PR(s) — one /loop 1m /muggle:muggle-pr-followup <slug> <pr#> per PR` | `No PRs to watch — stage 8 not dispatched`
**Errors:** repo → message

Address-reviews mode:

**PR updated:** URL (new SHA: <short-sha>)
**Title refreshed:** yes | no
**Body refreshed:** yes | no
**Walkthrough comment:** posted | skipped (no report)
**Overflow comment:** posted | skipped

## Post-merge cleanup

Gated by `autoCleanup`. Fires in a follow-up turn after merge — never from this stage. See [`../_shared/post-merge-cleanup.md`](../_shared/post-merge-cleanup.md).

Append one short reminder tied to the gate value:

- `always` → `Once merged, I'll run the cleanup sequence automatically.`
- `never` → omit.
- `ask` / absent → `Once merged, I'll check with you about cleanup.`
