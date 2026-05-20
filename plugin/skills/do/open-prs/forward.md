# Open PR — forward mode

Forward pipeline's Stage 7. Invoked by `/muggle-do` after stages 1–6 of a fresh feature. Creates the PR via `gh pr create`, seeds session state, dispatches the first watcher.

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

1. **Push:** `git push -u origin <branch>` in the repo directory.

2. **Title** (under 70 chars):
   - E2E report exists and has failures → `[E2E FAILING] <goal>`
   - No E2E report (validation was `unit-only` or `skip`) → `[UNVERIFIED] <goal>` or `[UNIT-ONLY] <goal>` to match the validation strategy
   - Otherwise → `<goal>`

3. **Body** — assemble in order:
   - `## Goal` — from requirements.
   - `## Acceptance Criteria` — bulleted; omit if empty.
   - `## Changes` — summary of what changed in this repo.
   - `## Validation` — one line: link to E2E report, `unit-only`, or `skip — <reason>`.
   - **If an E2E report exists,** invoke [`../../muggle-pr-visual-walkthrough/SKILL.md`](../../muggle-pr-visual-walkthrough/SKILL.md) Mode B to render the walkthrough block. Embed the returned `body` verbatim. If no report, skip this block entirely.

4. **Create:** `gh pr create --title "..." --body "..." --head <branch>`. Capture the PR URL and number.

5. **Overflow comment:** if the walkthrough skill returned a non-null `comment`, post it once per [`../../_shared/github-cli-recipes/top-level-comment.md`](../../_shared/github-cli-recipes/top-level-comment.md). Never post when `comment` is `null`.

## Stage 8 handoff

After every repo is processed, build the watcher manifest and dispatch one watcher loop per opened PR. The dispatches are the LAST action this stage takes.

Write `.muggle-do/sessions/<slug>/prs.json` per [`../../muggle-pr-followup/state-schemas.md`](../../muggle-pr-followup/state-schemas.md#prsjson):

```json
[{ "repo": "owner/repo", "number": 142, "url": "...", "head_sha": "...", "state": "open" }]
```

Seed `.muggle-do/sessions/<slug>/last_seen.json` per [`../../muggle-pr-followup/state-schemas.md`](../../muggle-pr-followup/state-schemas.md#last_seenjson) — empty cursor shape with `pushed_shas: []`. Forward mode never has prior reviews to skip, so `reviewId: 0`.

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

Gated by `autoCleanup`. Fires in a follow-up turn after merge — never from this stage. See [`../../_shared/post-merge-cleanup.md`](../../_shared/post-merge-cleanup.md).

Append one short reminder tied to the gate value:

- `always` → `Once merged, I'll run the cleanup sequence automatically.`
- `never` → omit.
- `ask` / absent → `Once merged, I'll check with you about cleanup.`
