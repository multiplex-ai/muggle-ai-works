# muggle-pr-followup — folder TOC

This folder holds the watcher loop that drives one PR toward merge-ready. The watcher is a **dumb pipe**: it polls for actionable review threads, CI checks, and the branch's standing against its base, and dispatches `/muggle-do` when there's review feedback, fixable red CI, or a branch behind or conflicting with its base. Cycle execution, classification, replies, rebases, and escalation all live in `/muggle-do` — see [stage-8 design](../../../../muggle-ai-brain/architecture/2026-05-08-muggle-do-pr-comment-loop-design.md) for the architectural rationale.

## Files in this folder

- [`SKILL.md`](SKILL.md) — public entry. Routing between bootstrap (URL input), tick (slug + PR number), and auto-track (no args). Read first.
- [`auto-track.md`](auto-track.md) — the no-args procedure: discovers PRs pushed this session (any repo) and seeds one poll-only watcher each. Seeds no E2E context — the watcher only watches.
- [`bootstrap.md`](bootstrap.md) — the bootstrap procedure (resolves the validation context once when the PR has a testable surface — else seeds poll-only like auto-track — then dispatches the first watcher).
- [`contract.md`](contract.md) — the watcher per-tick procedure (poll → dispatch → exit; on a human-blocked PR it reminds the owner each tick at the normal `1m` cadence, resuming evaluation on external change).
- [`blocked-tick.md`](blocked-tick.md) — the conditional blocked-path detail: fingerprint, flag-and-remind (Step 7), and remind-or-resume (Step 2.5), all at the normal `1m` cadence. Referenced by `contract.md`; runs only while `last_seen.blocked` is set.
- [`finalize.md`](finalize.md) — shared termination sequence for a terminal PR (mark terminal, `result.md`, log/telemetry, unschedule cron, post-merge cleanup handoff). Called by `contract.md` and `reconcile.md`.
- [`cancel-cron.md`](cancel-cron.md) — stops this watcher's cron, recorded-id-first (survives `CronList` going blind) with a `CronList`-match fallback, plus the tool-call-not-shell guard. Referenced by `contract.md` and `finalize.md`.
- [`record-cron-id.md`](record-cron-id.md) — the per-tick self-record that keeps this slot's cron id in `cron.json` deletable after a compaction blinds `CronList`. Referenced by `contract.md` Step 0.
- [`reconcile.md`](reconcile.md) — sweep that finalizes slots whose PR went terminal while polling lapsed, deletes orphaned crons, and re-arms open slots whose watcher stopped silently (dropped respawn); runs at the top of auto-track and on demand.
- [`state-schemas.md`](state-schemas.md) — canonical JSON shapes of session state files.
- [`output-templates.md`](output-templates.md) — TOC of message templates; per-group files in `output-templates/`.

## Cross-folder dependencies

Shared with other skills, under `../_shared/`:

- [`resolve-e2e-validation-context.md`](../_shared/resolve-e2e-validation-context.md) — the E2E validation-context contract bootstrap seeds into `state.md` (Step 6.5) and `do/e2e-acceptance.md` consumes.
- [`pr-followup-helpers.md`](../_shared/pr-followup-helpers.md) — TOC of allow-list / reply-routing / classify; per-section files in `_shared/pr-followup-helpers/`. Called by `/muggle-do`, not by this folder.
- [`telemetry-emit.md`](../_shared/telemetry-emit.md) — how to emit a telemetry event.
- [`telemetry-events.md`](../_shared/telemetry-events.md) — TOC of canonical event shapes; per-event files in `_shared/telemetry-events/`.
- [`vcs/github.md`](../_shared/vcs/github.md) — TOC of reusable `gh` / `git` snippets; per-recipe files in `_shared/vcs/github/`.

Callers (e.g. `/muggle-do`) reference this folder, not the reverse — see [`../CLAUDE.md`](../CLAUDE.md) for the one-way-dependency rule.
