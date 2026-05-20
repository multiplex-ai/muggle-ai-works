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

Extract `<owner>`, `<repo>`, `<pr-number>`. On malformed input, exit with the malformed-URL abort from [`output-templates.md`](output-templates.md).

### Step 2 — Fetch PR metadata

Use the "PR metadata snapshot" recipe from [`../_shared/github-cli-recipes.md`](../_shared/github-cli-recipes.md).

If `state` is `MERGED` or `CLOSED`, exit with the terminal-PR abort. There is nothing for a watcher to poll.

If the `gh` call itself fails (PR not found, auth missing), surface the underlying error verbatim and exit.

### Step 3 — Verify the working tree

Use the "Verify working tree matches the PR's repo" + "Verify the PR's branch is checked out" recipes. Both must pass. On any failure, exit with the wrong-working-tree abort. The message names what we see and what we expected — bootstrap does not know where the user keeps their clones, so it does not print an absolute remediation path.

### Step 4 — Resolve the slug

Default: `<repo>-pr<n>` (e.g. `muggle-ai-works-pr154`). Override: `--slug=<name>`. Session dir is `.muggle-do/sessions/<slug>/` relative to the caller's working tree.

### Step 5 — Idempotency check

If `.muggle-do/sessions/<slug>/` exists:

- Without `--resume` → exit with the slot-conflict abort. Both remedies (delete + re-run, or pass `--resume`) are spelled out in the message.
- With `--resume` → refresh `prs.json[0].head_sha` to the current `headRefOid` from Step 2. Leave `last_seen.json`, `state.md`, and everything else untouched. Skip to Step 8 (no need to re-seed; no need to refetch the cursor).

### Step 6 — Resolve the initial cursor

Query the highest existing submitted review id on the PR. Use the "Submitted reviews past a cursor" recipe with a cursor of 0, then take `max(id)`. If no submitted reviews exist, the cursor is 0.

The watcher will only act on reviews with `id > cursor`, so this pins it forward-only at the bootstrap moment.

### Step 7 — Seed state files

Identify the loop user once via the "Identifying the loop user" recipe; cache for `state.md`.

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

Use the bootstrap success-summary template from [`output-templates.md`](output-templates.md#success-summary-printed-just-before-dispatch). Print it **before** the `/loop` dispatch so it's visible in the turn's text output.

### Step 10 — Emit telemetry

Emit one `bootstrap` event per [`../_shared/telemetry-events.md`](../_shared/telemetry-events.md#bootstrap--one-per-successful-bootstrap). `caller = "user"` for direct invocation. Fire-and-forget per [`../_shared/telemetry-emit.md`](../_shared/telemetry-emit.md).

## Invariants

- All state writes happen in Step 7 — earlier aborts leave nothing on disk.
- If Step 7 fails mid-write, surface the OS error and tell the user to `rm -rf <slot>` and re-run; do not dispatch the watcher.
- Bootstrap never retries.
