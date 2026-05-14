# PR Creation Agent (Stage 7 — Open PR)

Open a pull request for each repo that has changes. If an E2E walkthrough report is available from the previous stage, attach it. Honor preference gates. Hand off to stage 8 once done.

## Turn preamble

```
**Stage 7 — Open PR** — pushing the branch and opening the PR.
```

## Inputs

- Per-repo: name, path, branch.
- Requirements: goal, acceptance criteria.
- **Optional** E2E acceptance report from stage 6 — only present when validation ran. Produced by [`e2e-acceptance.md`](e2e-acceptance.md); schema is canonical in [`muggle-pr-visual-walkthrough/SKILL.md`](../muggle-pr-visual-walkthrough/SKILL.md) (Zod-validated by the CLI).

## Per repo

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
   - **If an E2E report exists,** invoke [`muggle-pr-visual-walkthrough`](../muggle-pr-visual-walkthrough/SKILL.md) Mode B to render the walkthrough block. Embed the returned `body` verbatim (it brings its own `## E2E Acceptance Results` heading). If no report, skip this block entirely.

4. **Create:** `gh pr create --title "..." --body "..." --head <branch>`. Capture the PR URL and number.

5. **Overflow comment:** if the walkthrough skill returned a non-null `comment`, post it once:
   ```bash
   jq -r '.comment' /tmp/muggle-pr-section.json | gh pr comment <PR#> --body-file -
   ```
   Never post when `comment` is `null`.

## Stage 8 handoff

After every repo is processed, build the manifest and dispatch **one follow-up loop per opened PR**. The dispatches are the LAST action this stage takes — once they fire, the original session is free.

Write `.muggle-do/sessions/<slug>/prs.json` with one entry per **opened** PR (skip repos where `autoCreatePR` short-circuited or PR creation failed):

```json
[{ "repo": "owner/repo", "number": 142, "url": "...", "head_sha": "...", "state": "open" }]
```

Seed `.muggle-do/sessions/<slug>/last_seen.json` keyed by `"<owner>/<repo>#<n>"` with the empty-cursor shape (full shape in [`pr-followup.md`](pr-followup.md)). Stage 7 only seeds; each per-PR loop owns advancing its own cursor.

For each entry in `prs.json`, dispatch its own loop as the final action:
```
/loop 1m /muggle:muggle-do-pr-followup <slug> <pr-number>
```
Resolve `<slug>` from the session directory's basename. One loop per PR — multi-repo sessions opening N PRs result in N independent loops, each tracking its own PR's review thread.

If `prs.json` is empty (all repos skipped, or all PR creations failed), **do not dispatch** — record the reason in `result.md` and exit.

## Self-check before exit

- [ ] Every non-skipped repo got `gh pr create` to succeed.
- [ ] When an E2E report existed, the walkthrough block was rendered via Mode B (not hand-written).
- [ ] Overflow `comment` was posted only when non-null.
- [ ] `prs.json` and `last_seen.json` reflect the PRs actually opened.
- [ ] If `prs.json` is non-empty, the `/loop` dispatch was the last action.

## Output

**PRs Created:** repo → URL
**Skipped:** repo → reason (when `autoCreatePR` short-circuited)
**Overflow comments posted:** repo → PR #
**Stage 8:** `Watching <N> PR(s) — one /loop 1m /muggle:muggle-do-pr-followup <slug> <pr#> per PR` | `No PRs to watch — stage 8 not dispatched`
**Errors:** repo → message

## Post-merge cleanup

Gated by `autoCleanup`. Fires in a follow-up turn after merge — never from this stage. See [`../_shared/post-merge-cleanup.md`](../_shared/post-merge-cleanup.md).

Append one short reminder tied to the gate value:

- `always` → `Once merged, I'll run the cleanup sequence automatically.`
- `never` → omit.
- `ask` / absent → `Once merged, I'll check with you about cleanup.`
