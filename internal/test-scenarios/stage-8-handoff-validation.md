# Stage-8 handoff-shape validation

This file tracks how the watcher-handoff restructure gets validated. The architecture is a clean break from the cycle-declared shape that was round-2 validated on 2026-05-15 (PR #154) — that validation does NOT transfer.

## Pre-merge (verifiable on this PR)

Static checks completed during this dev cycle:

- [x] **vitest preference-gates-lint** — 66 tests passing. Confirms no `SKILL.md` preference table broke during the rewrite.
- [x] **vitest full suite** — 126/126 passing. No regressions in any CLI or MCP behavior.
- [x] **Cross-reference audit** — every `cycle.json` reference is either describing its removal (in the design docs / requirements) or in obsolete fixtures (since deleted). No skill file claims to read or write it.
- [x] **`do/pr-followup.md` orphans** — none. The file was never created (the per-tick contract has lived in `muggle-pr-followup/contract.md` since the original generic-extraction).
- [x] **Fixture schema refresh** — six new fixtures replace the seven obsolete ones. New schema uses `reviewId`, `escalated_review_ids`, `pushed_shas`. Old `commentId` / `escalated_comment_ids` fields gone.
- [x] **Build.md re-entry section** — refactored to reference the address-reviews orchestrator instead of "stage 8 dispatches back".
- [x] **pr-followup-helpers.md** — header rewritten to drop "deep-cycle through caller's implementation pipeline" lingo; allow-list section retargeted from "stage 8" to "the address-reviews flow".

## Post-merge

### Validation run 1 (2026-05-21) — scoped, author-agnostic

Run against PR #173 (closed). Plugin: `@muggleai/works` 4.12.0.

Author-agnostic checks (no second reviewer needed):

- [x] **Bootstrap fresh URL** — On PR #173 (no prior reviews). Cursor pinned to `0`. State files `prs.json` + `last_seen.json` + `state.md` seeded per [`state-schemas.md`](../../plugin/skills/muggle-pr-followup/state-schemas.md). No `cycle.json`, no `requirements.md`. `loop_user` cached as `stan4git`.
- [x] **Bootstrap wrong-checkout abort** — Verify-working-tree run from `muggle-ai-brain` checkout (wrong remote + wrong branch). Both checks fail; abort message renders per [`output-templates/bootstrap.md`](../../plugin/skills/muggle-pr-followup/output-templates/bootstrap.md); no slot written.
- [x] **Bootstrap conflict (no resume)** — Re-bootstrap with slot present. Refuses with both remedies (delete or `--resume`). State files untouched (sha256 stable).
- [x] **Bootstrap conflict (with `--resume`)** — Pushed a drift commit to change `headRefOid`. Re-bootstrap with `--resume` refreshed `prs.json[0].head_sha` to the new SHA; `last_seen.json` and `state.md` sha256 unchanged. Cursor + `pushed_shas[]` preserved.
- [x] **Watcher first tick — idle** — One tick against PR #173 (open, no new reviews past cursor 0). `idle_tick_count` 0→1, heartbeat line appended to `followup.log` in the right shape, no `/muggle-do` dispatch.
- [x] **Watcher terminal tick** — Closed PR #173 via `gh pr close`. Next tick: PR state refreshed to CLOSED, `prs.json[0].state` updated to `closed`, `result.md` written with the per-PR final state, terminal line appended to `followup.log`. No reschedule.

### Reviewer-dependent checks

A design issue surfaced before this batch ran: the original allow-list rule excluded the PR author. In single-account workflows (the canonical case — the human running the agent IS the PR author) that filters out **every** review the user submits on agent-opened PRs. Fixed in this PR: allow-list now = `(requested reviewers ∪ CODEOWNERS ∪ {PR author}) − bots`. The agent itself never appears in the submitted-reviews list (it pushes commits and posts inline replies; it does not submit GitHub reviews via the `/reviews` endpoint), so including the author is safe.

All five checks then run against PR #173 with two reviews from `stan4git` (one actionable + one ambiguous):

- [x] **Watcher dispatch shape** — both review ids dispatched in one directive: `/muggle-do address reviews 4340664661 4340664811 on <pr-url> slug=muggle-ai-works-pr173`. No classification, no reply at the watcher layer.
- [x] **Per-comment inline reply** — reply posted to line comment #3284293348 via `/comments/<id>/replies`; body cites the new SHA prefix (`835047f`). No summary reply on the review itself.
- [x] **Resolve-reminder top-level comment** — single top-level PR comment posted listing the one addressed-by-loop thread id, citing `835047f`. Visible at [PR #173 issuecomment-4512732912](https://github.com/multiplex-ai/muggle-ai-works/pull/173#issuecomment-4512732912).
- [x] **Ambiguous escalation** — review #4340664811 (body "👀") classified ambiguous; id appended to `escalated_review_ids`; terminal message rendered per `output-templates/escalation.md`.
- [x] **Mixed batch handling** — actionable + ambiguous processed in the same invocation: ONE push (`835047f`), ONE inline reply, ONE resolve-reminder comment, ONE terminal escalation message; cursor advanced past both ids (to `4340664811`); `cycles_completed` 0→1.

## Validation plan post-merge

Run the post-merge checks against a dedicated validation PR on muggle-ai-works (per the round-2 precedent). One PR per architectural change, with deliberately small test payloads so each scenario is isolatable.

Document outcomes back to this file (check the boxes; add notes for surprises).

## Known untested branches (filed as follow-up, not blockers)

- `useSubagent` — the old design had this flag in `cycle.json`; the new design has no `cycle.json`, so the concept is moot.
- `failed: design-adjustment` escalation — the build.md re-entry section now mentions it, but no test PR has exercised this code path yet.
- Multi-PR-from-one-session — bootstrap is one PR per invocation; the forward pipeline can open N PRs simultaneously. The N-watcher concurrent case has been described in design docs but not exercised on a real session.
