# Stage 8 Validation Run

End-to-end test of the `/muggle-do` stage-8 follow-up loop on a real GitHub PR. Sandbox PR; the file's only purpose is to be a vessel for reviewer comments.

## Procedure

1. This PR is opened.
2. The reviewer leaves three comments on lines of this file: one **directive** (clear, mechanical change), one **question** (asks for info, no implied change), one **ambiguous** (proposes an alternative without instructing).
3. The follow-up loop is dispatched: `/loop 5m /muggle:muggle-do-pr-followup stage-8-validation`.
4. Each polling tick classifies the oldest unaddressed comment per the rule in `_shared/pr-followup-helpers.md`, applies the muggle-do-specific routing in `do/pr-followup.md`, advances cursors, and exits.
5. The directive results in a push + reply. The question results in a reply only. The ambiguous comment results in an escalation terminal message and pauses this PR until the user resolves.
6. Restart safety is exercised by killing the loop after the first action and restarting from the same state.

## Session

- Slug: `stage-8-validation`
- Session dir: `.muggle-do/sessions/stage-8-validation/`
- PR: this PR
- Repo: `multiplex-ai/muggle-ai-works`

## Acceptance criteria

The test passes when:

- The directive comment receives a "Done in <sha> — ..." reply, the change is pushed.
- The question comment receives an inline answer, no push.
- The ambiguous comment receives no bot reply; the loop emits a single terminal message to the user and marks the PR escalated in `prs.json`.
- After a kill-and-restart, the loop resumes from `last_seen.json` without re-processing already-addressed comments.
- The loop continues polling until the PR is closed (or merged), then writes `result.md` and terminates.

## Out of scope

The deep-cycle (re-build) branch of the classify rule is not exercised in this test — it requires Stage 3 (Build) to actually re-implement code. Filed as a separate validation.
