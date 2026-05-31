# muggle-pr-followup — folder TOC

This folder holds the watcher loop for PR review follow-ups. The watcher is a **dumb pipe**: it polls for new submitted reviews and CI checks and dispatches `/muggle-do` when there's review feedback or fixable red CI. Cycle execution, classification, replies, and escalation all live in `/muggle-do`'s address-reviews mode — see [stage-8 design](../../../../muggle-ai-brain/architecture/2026-05-08-muggle-do-pr-comment-loop-design.md) for the architectural rationale.

## Files in this folder

- [`SKILL.md`](SKILL.md) — public entry. Routing between bootstrap (URL input), tick (slug + PR number), and auto-track (no args). Read first.
- [`auto-track.md`](auto-track.md) — the no-args procedure: discovers PRs pushed this session (any repo) and seeds one poll-only watcher each. Seeds no E2E context — the watcher only watches.
- [`bootstrap.md`](bootstrap.md) — the bootstrap procedure (asks once for the E2E validation context, seeds state, dispatches the first watcher).
- [`contract.md`](contract.md) — the watcher per-tick procedure (poll → dispatch → exit).
- [`state-schemas.md`](state-schemas.md) — canonical JSON shapes of session state files.
- [`output-templates.md`](output-templates.md) — TOC of message templates; per-group files in `output-templates/`.

## Cross-folder dependencies

Shared with other skills, under `../_shared/`:

- [`resolve-e2e-validation-context.md`](../_shared/resolve-e2e-validation-context.md) — the E2E validation-context contract bootstrap seeds into `state.md` (Step 6.5) and `do/e2e-acceptance.md` consumes.
- [`pr-followup-helpers.md`](../_shared/pr-followup-helpers.md) — TOC of allow-list / reply-routing / classify; per-section files in `_shared/pr-followup-helpers/`. Called by `/muggle-do`, not by this folder.
- [`telemetry-emit.md`](../_shared/telemetry-emit.md) — how to emit a telemetry event.
- [`telemetry-events.md`](../_shared/telemetry-events.md) — TOC of canonical event shapes; per-event files in `_shared/telemetry-events/`.
- [`github-cli-recipes.md`](../_shared/github-cli-recipes.md) — TOC of reusable `gh` / `git` snippets; per-recipe files in `_shared/github-cli-recipes/`.

Caller-specific, under `../do/`:

- [`open-prs.md`](../do/open-prs.md) — TOC for the create-or-update PR stage; per-mode files in `do/open-prs/`.
- [`resolve-reminder.md`](../do/resolve-reminder.md) — `/muggle-do`'s per-round stage that nudges the reviewer to resolve addressed-but-still-open threads.
