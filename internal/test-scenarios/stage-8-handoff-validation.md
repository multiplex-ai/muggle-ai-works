# Stage-8 handoff-shape validation

Checklist of what to validate for the watcher-handoff restructure. Run outcomes (evidence, PR refs, SHAs, etc.) live in PR descriptions, not here — this file stays a spec, not a log.

The architecture is a clean break from the cycle-declared shape that was round-2 validated on 2026-05-15 (PR #154); that validation does NOT transfer.

## Pre-merge static checks

- [x] vitest preference-gates-lint passing
- [x] vitest full suite passing
- [x] No stale references to `cycle.json` outside removal context
- [x] No orphan refs to `do/pr-followup.md`
- [x] Fixtures refreshed to new schema (`reviewId`, `escalated_review_ids`, `pushed_shas`)
- [x] `do/build.md` re-entry section retargeted at the address-reviews orchestrator
- [x] `pr-followup-helpers.md` header + allow-list section retargeted

## Post-merge dynamic checks

Run on a real PR. Document outcomes in the run's PR description, not here.

### Author-agnostic

- [x] Bootstrap fresh URL → state seeded per schema; no `cycle.json` / `requirements.md`
- [x] Bootstrap wrong-checkout abort → no state written
- [x] Bootstrap conflict (no `--resume`) → refuse with both remedies; state untouched
- [x] Bootstrap conflict (`--resume`) → refresh `head_sha` only; cursor + `pushed_shas[]` preserved
- [x] Watcher idle tick → `idle_tick_count` increments; heartbeat logged; no dispatch
- [x] Watcher terminal tick → `result.md` written on PR close/merge; no reschedule

### Reviewer-dependent

- [x] Watcher dispatches new reviews past cursor (excluding escalated)
- [x] `/muggle-do` posts one inline reply per line comment citing the new SHA
- [x] `/muggle-do` posts one top-level resolve-reminder per cycle when threads were addressed
- [x] Ambiguous review → escalated set + terminal message; no push
- [x] Mixed batch (actionable + ambiguous) → both branches in same invocation
- [x] Self-loop filter → agent's own reply-wrapper reviews advance cursor silently

## Known untested branches (follow-up, not blockers)

- `failed: design-adjustment` escalation — no test PR has surfaced a real design conflict yet
- Multi-PR session — N-watcher concurrent case is structural rather than exercised
- Forward-only cursor on bootstrap-of-existing-PR — current default is "skip prior reviews"; surprising when the user wants those addressed. Workaround: lower cursor manually. Future: prompt at bootstrap.
