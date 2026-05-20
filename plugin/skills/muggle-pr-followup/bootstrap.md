# Bootstrap Procedure

The procedure for the **bootstrap mode** of `muggle-pr-followup` — invoked when a user dispatches the skill with a GitHub PR URL. Routing into this mode is documented in [`SKILL.md`](SKILL.md#routing).

Bootstrap is **non-interactive**: it runs straight through, prompts the user for nothing, and ends with the first watcher dispatched. The first review the watcher sees triggers `/muggle-do`, where working-tree validation surfaces (via the existing E2E stage / muggle-test).

## Turn preamble

```
**muggle-pr-followup bootstrap** — seeding state for <owner>/<repo>#<n>.
```

## Input

`$ARGUMENTS = <pr-url> [--slug=<name>] [--resume]`

- `<pr-url>` matches `https?://github\.com/[^/]+/[^/]+/pull/\d+` — required.
- `--slug=<name>` overrides the default `<repo>-pr<n>` slug.
- `--resume` opts into refreshing an existing slot instead of refusing on conflict.

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
- With `--resume` → refresh `prs.json[0].head_sha` to the current `headRefOid` from Step 2. Leave `last_seen.json`, `state.md`, and everything else untouched. Skip to Step 8 (no need to re-seed; no need to refetch the cursor).

### Step 6 — Resolve the initial cursor

Fetch reviews per [`../_shared/github-cli-recipes/submitted-reviews.md`](../_shared/github-cli-recipes/submitted-reviews.md) with cursor 0, then take `max(id)`. If none, the cursor is 0. The watcher only acts on `id > cursor`, so this pins forward-only.

### Step 7 — Seed state files

Identify the loop user once per [`../_shared/github-cli-recipes/loop-user-identity.md`](../_shared/github-cli-recipes/loop-user-identity.md); cache in `state.md`.

Write under `.muggle-do/sessions/<slug>/`:

**`prs.json`** — see [`state-schemas.md`](state-schemas.md#prsjson). One entry, `state` = `"open"`, `head_sha` from Step 2's `headRefOid`.

**`last_seen.json`** — see [`state-schemas.md`](state-schemas.md#last_seenjson). One key (`"<owner>/<repo>#<n>"`), `reviewId` from Step 6, `last_pushed_sha: null`, `idle_tick_count: 0`, `cycles_completed: 0`, `escalated_review_ids: []`, `pushed_shas: []`.

**`state.md`** — see [`state-schemas.md`](state-schemas.md#statemd). `Bootstrapped from URL: yes`. Cache the loop-user login.

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

- All state writes happen in Step 7 — earlier aborts leave nothing on disk.
- If Step 7 fails mid-write, surface the OS error and tell the user to `rm -rf <slot>` and re-run; do not dispatch the watcher.
- Bootstrap never retries.
