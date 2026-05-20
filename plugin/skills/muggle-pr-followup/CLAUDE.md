# muggle-pr-followup — folder TOC

This folder holds the watcher loop for PR review follow-ups. The watcher is a **dumb pipe**: it polls for new submitted reviews and dispatches `/muggle-do` when there are any. Cycle execution, classification, replies, and escalation all live in `/muggle-do`'s address-reviews mode — see [stage-8 design](../../../../muggle-ai-brain/architecture/2026-05-08-muggle-do-pr-comment-loop-design.md) for the architectural rationale.

## Files in this folder

- [`SKILL.md`](SKILL.md) — public entry. Smart-inference routing between bootstrap mode (URL input) and tick mode (slug + PR number). Read first.
- [`bootstrap.md`](bootstrap.md) — the bootstrap procedure (one-shot non-interactive seed + watcher dispatch).
- [`contract.md`](contract.md) — the watcher per-tick procedure (poll → dispatch → exit).
- [`state-schemas.md`](state-schemas.md) — canonical JSON shapes of session state files.
- [`output-templates.md`](output-templates.md) — user-facing summary, abort, and error message templates.

## Cross-folder dependencies

Shared with other skills, under `../_shared/`:

- [`pr-followup-helpers.md`](../_shared/pr-followup-helpers.md) — allow-list, reply routing, classify rule. Called by `/muggle-do`, not by this folder.
- [`telemetry-emit.md`](../_shared/telemetry-emit.md) — how to emit a telemetry event.
- [`telemetry-events.md`](../_shared/telemetry-events.md) — canonical event shapes.
- [`github-cli-recipes.md`](../_shared/github-cli-recipes.md) — reusable `gh` / `git` snippets.

Caller-specific, under `../do/`:

- [`open-prs.md`](../do/open-prs.md) — stage 7 of `/muggle-do`'s forward pipeline. Creates the PR and dispatches the first watcher.
- [`resolve-reminder.md`](../do/resolve-reminder.md) — `/muggle-do`'s post-replies stage that posts the resolve-reminder top-level comment.
