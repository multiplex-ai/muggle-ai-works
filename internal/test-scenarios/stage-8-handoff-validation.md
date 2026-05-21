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

Run against PR #173 (closed). Plugin at `@muggleai/works` 4.12.0 (cached). The watcher and bootstrap procedures were exercised manually step-by-step against the cached 4.12.0 skill files — the skill itself is `disable-model-invocation`, so it's invoked via `/loop` only, not programmatic.

Author-agnostic checks (no second reviewer needed):

- [x] **Bootstrap fresh URL** — On PR #173 (no prior reviews). Cursor pinned to `0`. State files `prs.json` + `last_seen.json` + `state.md` seeded per [`state-schemas.md`](../../plugin/skills/muggle-pr-followup/state-schemas.md). No `cycle.json`, no `requirements.md`. `loop_user` cached as `stan4git`.
- [x] **Bootstrap wrong-checkout abort** — Verify-working-tree run from `muggle-ai-brain` checkout (wrong remote + wrong branch). Both checks fail; abort message renders per [`output-templates/bootstrap.md`](../../plugin/skills/muggle-pr-followup/output-templates/bootstrap.md); no slot written.
- [x] **Bootstrap conflict (no resume)** — Re-bootstrap with slot present. Refuses with both remedies (delete or `--resume`). State files untouched (sha256 stable).
- [x] **Bootstrap conflict (with `--resume`)** — Pushed a drift commit to change `headRefOid`. Re-bootstrap with `--resume` refreshed `prs.json[0].head_sha` to the new SHA; `last_seen.json` and `state.md` sha256 unchanged. Cursor + `pushed_shas[]` preserved.
- [x] **Watcher first tick — idle** — One tick against PR #173 (open, no new reviews past cursor 0). `idle_tick_count` 0→1, heartbeat line appended to `followup.log` in the right shape, no `/muggle-do` dispatch.
- [x] **Watcher terminal tick** — Closed PR #173 via `gh pr close`. Next tick: PR state refreshed to CLOSED, `prs.json[0].state` updated to `closed`, `result.md` written with the per-PR final state, terminal line appended to `followup.log`. No reschedule.

### Reviewer-dependent checks (still pending)

Defer until a non-`stan4git` reviewer account is available. The PR-author exclusion in the allow-list filters reviews from `stan4git` on `stan4git`'s own test PR.

- [ ] **Watcher dispatch shape** — fire a watcher tick on a real PR with a new submitted review from a non-author. Expect the watcher invokes `/muggle-do` with the address-reviews directive carrying the review id, then exits. No classification, no reply, no PR-side activity from the watcher.
- [ ] **Per-comment inline replies** — submit a review with 3 line comments. Expect 3 nested replies (one per comment thread), each citing the new SHA prefix. No top-level summary reply on the review.
- [ ] **Resolve-reminder top-level comment** — same review as above. Expect ONE top-level PR comment listing the 3 thread ids. Body cites the same SHA.
- [ ] **Ambiguous escalation in `/muggle-do`** — submit a deliberately ambiguous review (e.g. just "👀"). Expect a single terminal escalation message naming the review; expect the review id added to `escalated_review_ids`; expect the watcher to be respawned and to subsequently ignore that review id.
- [ ] **Mixed batch handling** — submit two reviews back-to-back (one actionable, one ambiguous) such that the watcher sees them in one tick. Expect ONE `/muggle-do` invocation, ONE push, replies for the actionable comments only, ONE resolve-reminder, ONE terminal escalation message for the ambiguous review.

## Validation plan post-merge

Run the post-merge checks against a dedicated validation PR on muggle-ai-works (per the round-2 precedent). One PR per architectural change, with deliberately small test payloads so each scenario is isolatable.

Document outcomes back to this file (check the boxes; add notes for surprises).

## Known untested branches (filed as follow-up, not blockers)

- `useSubagent` — the old design had this flag in `cycle.json`; the new design has no `cycle.json`, so the concept is moot.
- `failed: design-adjustment` escalation — the build.md re-entry section now mentions it, but no test PR has exercised this code path yet.
- Multi-PR-from-one-session — bootstrap is one PR per invocation; the forward pipeline can open N PRs simultaneously. The N-watcher concurrent case has been described in design docs but not exercised on a real session.
