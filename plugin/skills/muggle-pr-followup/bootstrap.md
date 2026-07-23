# Bootstrap Procedure

The procedure for the **bootstrap mode** of `muggle-pr-followup` — invoked when a user dispatches the skill with a GitHub PR URL. Routing into this mode is documented in [`SKILL.md`](SKILL.md#routing).

Bootstrap seeds watcher state and dispatches the first tick. The watcher itself is generic: it follows one PR's reviews, CI, and merge state whether or not E2E applies. Validation context is **optional** and gathered here only because this is the one moment the user is present — so later unattended ticks can run E2E without prompting. When the PR has a testable surface, bootstrap resolves that context once and every later tick reads it from `state.md`. When there's no testable surface, or the user declines, bootstrap seeds the watcher **poll-only** (no validation context), exactly like [`auto-track`](auto-track.md) — a watcher with no context yields a clean `SKIPPED` E2E verdict when `/muggle-do` runs, not a failure.

## Turn preamble

```
**muggle-pr-followup bootstrap** — seeding state for <owner>/<repo>#<n>.
```

## Input

`$ARGUMENTS = <pr-url> [--slug=<name>] [--resume] [--forward-only]`

- `<pr-url>` matches `https?://github\.com/[^/]+/[^/]+/pull/\d+` — required.
- `--slug=<name>` overrides the default `<repo>-pr<n>` slug.
- `--resume` opts into refreshing an existing slot instead of refusing on conflict.
- `--forward-only` pins `lastBodyReviewId` past existing **body-only** reviews (skip history on those). It does **not** affect line-comment threads — those are always picked up from live thread state. Default is `0`.

## Procedure

### Step 1 — Parse the URL

Extract `<owner>`, `<repo>`, `<pr-number>`. On malformed input, exit with the malformed-URL abort from [`output-templates/bootstrap.md`](output-templates/bootstrap.md).

### Step 2 — Fetch PR metadata

Per [`../_shared/vcs/github/pr-metadata.md`](../_shared/vcs/github/pr-metadata.md).

If `state` is `MERGED` or `CLOSED`, exit with the terminal-PR abort. If the `gh` call fails (not found, auth missing), surface the underlying error verbatim and exit.

### Step 3 — Verify the working tree

Per [`../_shared/vcs/github/verify-working-tree.md`](../_shared/vcs/github/verify-working-tree.md). On any check failure, exit with the wrong-working-tree abort.

### Step 4 — Resolve the slug

Default: `<repo>-pr<n>` (e.g. `muggle-ai-works-pr154`). Override: `--slug=<name>`. Session dir is `~/.muggle-ai/muggle-do/sessions/<slug>/` (under the user's home, shared across repos; the slug's repo-pr<n> prefix keeps it unique).

### Step 5 — Idempotency check

**Legacy-slot migration.** Pre-move sessions lived at the repo-relative `.muggle-do/sessions/<slug>/` ([`state-schemas.md`](state-schemas.md#legacy-location)). If the new home-dir slot is absent but `<working-tree>/.muggle-do/sessions/<slug>/` exists (working tree from Step 3), move it to the new location first — this carries an in-flight watcher's cursor, `escalated_review_ids`, and `pushed_shas` across the upgrade. Bootstrap is the only stage that performs this: it is the one entry point that knows the old repo-relative path (the cwd), and it is the natural re-entry point after a plugin upgrade. A slot that fails to migrate loses nothing durable — GitHub holds the reviews, so a fresh bootstrap (cursor `0`) re-processes them.

If `~/.muggle-ai/muggle-do/sessions/<slug>/` exists (including a slot just migrated above):

- Without `--resume` → exit with the slot-conflict abort. Both remedies (delete + re-run, or pass `--resume`) are spelled out in the message.
- With `--resume` → refresh `prs.json[0].head_sha` to the current `headRefOid` from Step 2; leave `last_seen.json` untouched. If `state.md` already has a `## Pre-flight answers` block, skip to Step 8; if not (older session), run Step 6.5 to backfill it, then skip to Step 8.

### Step 6 — Resolve the body-only watermark

Line-comment threads need no seeding — the watcher derives them from live thread state on every tick, so existing unresolved threads are picked up on the first tick regardless of this step. This step only sets `lastBodyReviewId`, the narrow watermark for body-only reviews (a submitted review with no line comments).

- **Default (no `--forward-only`):** `lastBodyReviewId = 0`. The watcher picks up every existing body-only review on its first tick. Matches the common case — the user opened the PR, left feedback they want addressed, and is now bootstrapping.
- **With `--forward-only`:** fetch reviews per [`../_shared/vcs/github/submitted-reviews.md`](../_shared/vcs/github/submitted-reviews.md), then take `max(id)`. Body-only reviews at or below that id are treated as already-handled. This no longer hides existing line-comment threads — those are always picked up from thread state.

### Step 6.5 — Resolve the validation context (skip when there's nothing to E2E)

The only step that may prompt the user, and only when the PR has a testable surface. Run silent detection from [`../_shared/resolve-e2e-validation-context.md`](../_shared/resolve-e2e-validation-context.md) first. If it finds **no dev server / no testable surface** — a docs, config, skill, or library change, or a non-web repo — seed the watcher **poll-only**: no prompt, no `## Pre-flight answers` block, continue to Step 7 (same as [`auto-track`](auto-track.md)).

Otherwise resolve the context per that file: reuse an existing one (gated by `autoReuseValidationContext`), else one `AskUserQuestion` (strategy, local URL, backend, project, credentials, re-auth) with detected values as defaults; record Step 3's verified working tree as `Working tree`. The user may pick `skip`/`unit-only` or decline the prompt outright — either way, seed poll-only and continue. Never abort the watcher over validation.

Capture any resolved fields for Step 7. Do **not** run E2E now — the first watcher tick that dispatches `/muggle-do` does that.

### Step 7 — Seed state files

Identify the loop user once per [`../_shared/vcs/github/loop-user-identity.md`](../_shared/vcs/github/loop-user-identity.md); cache in `state.md`.

Write under `~/.muggle-ai/muggle-do/sessions/<slug>/`:

**`prs.json`** — see [`state-schemas.md`](state-schemas.md#prsjson). One entry, `state` = `"open"`, `head_sha` from Step 2's `headRefOid`.

**`last_seen.json`** — see [`state-schemas.md`](state-schemas.md#last_seenjson). One key (`"<owner>/<repo>#<n>"`), `lastBodyReviewId` from Step 6, `last_pushed_sha: null`, `idle_tick_count: 0`, `cycles_completed: 0`, `escalated_review_ids: []`, `pushed_shas: []`. Omit `blocked` — the watcher starts unblocked.

**`cron.json`** — see [`state-schemas.md`](state-schemas.md#cronjson). `cron_id: null` (bootstrap arms no cron; a tick running under one recorded by [`reconcile.md`](reconcile.md) self-records its id per [`record-cron-id.md`](record-cron-id.md)), `command: "/muggle:muggle-pr-followup <slug> <n>"`, `interval: "1m"`, `recorded_at: <now>`.

**`state.md`** — see [`state-schemas.md`](state-schemas.md#statemd). `Bootstrapped from URL: yes`. Cache the loop-user login. If Step 6.5 resolved a validation context, append the `## Pre-flight answers` block with its fields, per [`../_shared/resolve-e2e-validation-context.md`](../_shared/resolve-e2e-validation-context.md#persisted-fields). If it seeded poll-only, write **no** such block — a missing block is a clean E2E skip.

Do **not** write `cycle.json` or `requirements.md` — those files are no longer part of the session slot.

Create `iterations/` subdir (empty) for future caller use.

### Step 8 — Arm the watch

Arm per [`arm-watcher.md`](arm-watcher.md) as the last action of the turn: one tick drains anything already actionable — this is the first tick Step 6 promises — then a persistent, labeled monitor keeps watch — visible until the PR terminates. The cron path stays as the recovery substrate ([`reconcile.md`](reconcile.md)), so `cron.json` is still seeded in Step 7.

### Step 9 — Print the success summary

Use the success-summary template from [`output-templates/bootstrap.md`](output-templates/bootstrap.md). Print it **before** arming the watch so it's visible.

### Step 10 — Emit telemetry

Emit one event per [`../_shared/telemetry-events/pr-followup-bootstrap.md`](../_shared/telemetry-events/pr-followup-bootstrap.md). `caller = "user"` for direct invocation. Fire-and-forget per [`../_shared/telemetry-emit.md`](../_shared/telemetry-emit.md).

## Invariants

- Step 6.5 is the **only** user prompt, and only when a testable surface exists. Cancelling or declining it is **not** an abort — fall back to a poll-only watcher (no `## Pre-flight answers` block) and continue to Step 7.
- All state writes happen in Step 7. Only the earlier aborts (malformed URL, terminal PR, wrong working tree, slot conflict) leave nothing on disk.
- If Step 7 fails mid-write, surface the OS error and tell the user to `rm -rf <slot>` and re-run; do not dispatch the watcher.
- Bootstrap never retries.
