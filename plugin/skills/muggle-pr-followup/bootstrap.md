# Bootstrap Procedure

The procedure for the **bootstrap mode** of `muggle-pr-followup` — invoked when a user dispatches the skill with a GitHub PR URL. Routing into this mode is documented in [`SKILL.md`](SKILL.md#routing).

Bootstrap asks **one** questionnaire — the E2E validation context the autonomous loop will reuse — then runs straight through to the first watcher dispatch. The user is present at launch, so this is the one place to gather it: every later watcher tick is non-interactive and reads the persisted context from `state.md`. Without it, an address-reviews cycle on a URL-bootstrapped watcher has no `localUrl`/`projectId` and Stage 6 hard-halts instead of running E2E.

## Turn preamble

```
**muggle-pr-followup bootstrap** — seeding state for <owner>/<repo>#<n>.
```

## Input

`$ARGUMENTS = <pr-url> [--slug=<name>] [--resume] [--forward-only]`

- `<pr-url>` matches `https?://github\.com/[^/]+/[^/]+/pull/\d+` — required.
- `--slug=<name>` overrides the default `<repo>-pr<n>` slug.
- `--resume` opts into refreshing an existing slot instead of refusing on conflict.
- `--forward-only` pins the cursor past existing reviews (skip history). Default is cursor 0 — the watcher will pick up prior submitted reviews on its first tick.

## Procedure

### Step 1 — Parse the URL

Extract `<owner>`, `<repo>`, `<pr-number>`. On malformed input, exit with the malformed-URL abort from [`output-templates/bootstrap.md`](output-templates/bootstrap.md).

### Step 2 — Fetch PR metadata

Per [`../_shared/github-cli-recipes/pr-metadata.md`](../_shared/github-cli-recipes/pr-metadata.md).

If `state` is `MERGED` or `CLOSED`, exit with the terminal-PR abort. If the `gh` call fails (not found, auth missing), surface the underlying error verbatim and exit.

### Step 3 — Verify the working tree

Per [`../_shared/github-cli-recipes/verify-working-tree.md`](../_shared/github-cli-recipes/verify-working-tree.md). On any check failure, exit with the wrong-working-tree abort.

### Step 4 — Resolve the slug

Default: `<repo>-pr<n>` (e.g. `muggle-ai-works-pr154`). Override: `--slug=<name>`. Session dir is `.muggle-do/sessions/<slug>/` relative to the caller's working tree.

### Step 5 — Idempotency check

If `.muggle-do/sessions/<slug>/` exists:

- Without `--resume` → exit with the slot-conflict abort. Both remedies (delete + re-run, or pass `--resume`) are spelled out in the message.
- With `--resume` → refresh `prs.json[0].head_sha` to the current `headRefOid` from Step 2. Leave `last_seen.json` and the cursor untouched. If `state.md` already carries the E2E validation context (a `## Pre-flight answers` block), skip to Step 8. If it predates this block (older session), run Step 6.5 to backfill the context, then skip to Step 8.

### Step 6 — Resolve the initial cursor

- **Default (no `--forward-only`):** cursor is `0`. The watcher will pick up every existing submitted review on its first tick. This matches the common case where the user opened the PR, left review comments they want addressed, and is now running bootstrap.
- **With `--forward-only`:** fetch reviews per [`../_shared/github-cli-recipes/submitted-reviews.md`](../_shared/github-cli-recipes/submitted-reviews.md), then take `max(id)`. The watcher only acts on later submissions. Use when bootstrapping a PR with stale/already-handled prior reviews you don't want re-processed.

### Step 6.5 — Resolve E2E validation context

The only interactive step. Run the gather defined in [`../_shared/e2e-validation-context.md`](../_shared/e2e-validation-context.md): silent detection, then one `AskUserQuestion` for the validation subset (strategy, local URL, backend, project, credentials, re-auth). The working tree verified in Step 3 is the checkout the loop runs against — record it as `Working tree`.

Capture the resolved fields for Step 7. Do **not** run E2E now — the first watcher tick that dispatches `/muggle-do` does that.

### Step 7 — Seed state files

Identify the loop user once per [`../_shared/github-cli-recipes/loop-user-identity.md`](../_shared/github-cli-recipes/loop-user-identity.md); cache in `state.md`.

Write under `.muggle-do/sessions/<slug>/`:

**`prs.json`** — see [`state-schemas.md`](state-schemas.md#prsjson). One entry, `state` = `"open"`, `head_sha` from Step 2's `headRefOid`.

**`last_seen.json`** — see [`state-schemas.md`](state-schemas.md#last_seenjson). One key (`"<owner>/<repo>#<n>"`), `reviewId` from Step 6, `last_pushed_sha: null`, `idle_tick_count: 0`, `cycles_completed: 0`, `escalated_review_ids: []`, `pushed_shas: []`.

**`state.md`** — see [`state-schemas.md`](state-schemas.md#statemd). `Bootstrapped from URL: yes`. Cache the loop-user login. Append the `## Pre-flight answers` block with the fields resolved in Step 6.5, per [`../_shared/e2e-validation-context.md`](../_shared/e2e-validation-context.md#persisted-fields).

Do **not** write `cycle.json` or `requirements.md` — those files are no longer part of the session slot.

Create `iterations/` subdir (empty) for future caller use.

### Step 8 — Dispatch the first watcher

The last action of this turn:

```
/loop 1m /muggle:muggle-pr-followup <slug> <n>
```

### Step 9 — Print the success summary

Use the success-summary template from [`output-templates/bootstrap.md`](output-templates/bootstrap.md). Print it **before** the `/loop` dispatch so it's visible.

### Step 10 — Emit telemetry

Emit one event per [`../_shared/telemetry-events/pr-followup-bootstrap.md`](../_shared/telemetry-events/pr-followup-bootstrap.md). `caller = "user"` for direct invocation. Fire-and-forget per [`../_shared/telemetry-emit.md`](../_shared/telemetry-emit.md).

## Invariants

- Step 6.5 is the **only** user prompt. If the user cancels it, abort leaving nothing on disk.
- All state writes happen in Step 7 — earlier aborts (including a cancelled Step 6.5) leave nothing on disk.
- If Step 7 fails mid-write, surface the OS error and tell the user to `rm -rf <slot>` and re-run; do not dispatch the watcher.
- Bootstrap never retries.
