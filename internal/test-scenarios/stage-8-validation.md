# Stage 8 Validation Run

End-to-end test of the `/muggle-do` stage-8 follow-up loop on a real GitHub PR. Sandbox PR; the file's only purpose is to be a vessel for reviewer comments.

## Procedure

1. Open this PR; leave three comments (directive, question, ambiguous).
2. Dispatch the loop: `/loop 1m /muggle:muggle-do-pr-followup stage-8-validation`.
3. Each tick classifies one comment per the helpers rule and routes per `do/pr-followup.md`. Directive → push + reply. Question → reply only. Ambiguous → escalate.
4. Kill and restart the loop mid-run to confirm restart safety against `last_seen.json`.

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
