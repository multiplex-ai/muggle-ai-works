# Stage-8 handoff-shape validation

This file tracks how the watcher-handoff restructure gets validated. The architecture is a clean break from the cycle-declared shape that was round-2 validated on 2026-05-15 (PR #154) — that validation does NOT transfer.

> **Validation run 1 (2026-05-21)** — scoped, author-agnostic checks only. Outcomes filled in below. Reviewer-dependent checks remain pending (require a non-author reviewer; deferred until a second test account is set up).

## Pre-merge (verifiable on this PR)

Static checks completed during this dev cycle:

- [x] **vitest preference-gates-lint** — 66 tests passing. Confirms no `SKILL.md` preference table broke during the rewrite.
- [x] **vitest full suite** — 126/126 passing. No regressions in any CLI or MCP behavior.
- [x] **Cross-reference audit** — every `cycle.json` reference is either describing its removal (in the design docs / requirements) or in obsolete fixtures (since deleted). No skill file claims to read or write it.
- [x] **`do/pr-followup.md` orphans** — none. The file was never created (the per-tick contract has lived in `muggle-pr-followup/contract.md` since the original generic-extraction).
- [x] **Fixture schema refresh** — six new fixtures replace the seven obsolete ones. New schema uses `reviewId`, `escalated_review_ids`, `pushed_shas`. Old `commentId` / `escalated_comment_ids` fields gone.
- [x] **Build.md re-entry section** — refactored to reference the address-reviews orchestrator instead of "stage 8 dispatches back".
- [x] **pr-followup-helpers.md** — header rewritten to drop "deep-cycle through caller's implementation pipeline" lingo; allow-list section retargeted from "stage 8" to "the address-reviews flow".

## Post-merge (requires the new shape to be active)

The following can only be validated once this PR is merged and the plugin is re-installed:

- [ ] **Watcher dispatch shape** — Fire a watcher tick on a real PR with a new submitted review. Expect: the watcher invokes `/muggle-do` with the address-reviews directive carrying the review id, then exits. No classification, no reply, no PR-side activity from the watcher.
- [ ] **Per-comment inline replies** — Submit a review with 3 line comments on a real PR. Expect 3 nested replies (one per comment thread), each citing the new SHA prefix. No top-level summary reply on the review.
- [ ] **Resolve-reminder top-level comment** — Same review as above. Expect ONE top-level PR comment listing the 3 thread ids. Body cites the same SHA.
- [ ] **Ambiguous escalation in `/muggle-do`** — Submit a deliberately ambiguous review (e.g. just "👀"). Expect a single terminal escalation message naming the review; expect the review id added to `escalated_review_ids`; expect the watcher to be respawned and to subsequently ignore that review id.
- [ ] **Mixed batch handling** — Submit two reviews back-to-back (one actionable, one ambiguous) such that the watcher sees them in one tick. Expect ONE `/muggle-do` invocation, ONE push, replies for the actionable comments only, ONE resolve-reminder, ONE terminal escalation message for the ambiguous review.
- [ ] **Bootstrap fresh URL** — Run `/muggle:muggle-pr-followup <pr-url>` on a PR that has prior reviews. Expect: state files seeded with `reviewId` pinned to `max(existing review ids)`, cursor forward-only, `/loop 1m ...` dispatched as the last action. No muggle-test prompt.
- [ ] **Bootstrap wrong-checkout abort** — Run bootstrap from a working tree that's not the PR's repo. Expect: clean abort with the cd + `gh pr checkout` snippet; no state files written.
- [ ] **Bootstrap conflict-with-resume** — Run bootstrap with `--resume` against an existing slot. Expect: only `prs.json[0].head_sha` refreshed; `last_seen.json` / `state.md` untouched.
- [ ] **Watcher terminal on PR close/merge** — Close a PR mid-loop. Expect the next watcher tick to write `result.md` and exit terminally without scheduling another tick.

## Validation plan post-merge

Run the post-merge checks against a dedicated validation PR on muggle-ai-works (per the round-2 precedent). One PR per architectural change, with deliberately small test payloads so each scenario is isolatable.

Document outcomes back to this file (check the boxes; add notes for surprises).

## Known untested branches (filed as follow-up, not blockers)

- `useSubagent` — the old design had this flag in `cycle.json`; the new design has no `cycle.json`, so the concept is moot.
- `failed: design-adjustment` escalation — the build.md re-entry section now mentions it, but no test PR has exercised this code path yet.
- Multi-PR-from-one-session — bootstrap is one PR per invocation; the forward pipeline can open N PRs simultaneously. The N-watcher concurrent case has been described in design docs but not exercised on a real session.
<!-- run 1 head_sha drift test -->
