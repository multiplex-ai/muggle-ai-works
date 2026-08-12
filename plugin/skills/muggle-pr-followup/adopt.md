# Adopt Procedure

The procedure for the **adopt mode** of `muggle-pr-followup` — the user's deliberate takeover of a watcher slot owned by a session that is gone. Routing is in [`SKILL.md`](SKILL.md#routing).

Adoption is the only way a slot changes hands. [`reconcile.md`](reconcile.md) re-arms watchers this session already owns and refuses everything else; this file is the door it refuses through. Both exist because a watcher polls a PR in order to hand review work to `/muggle-do` **inside the owning session** — the session that carries the design decisions, the reviewer's phrasing, and the reasoning behind the branch. A session adopting a PR takes that job on without any of it, so the user has to say so.

## Input

`$ARGUMENTS` is `adopt`, optionally followed by a `<slug>`.

- **`adopt <slug>`** — take that slot.
- **`adopt`** alone — list the adoptable slots and stop. It is a query, not a prompt: print the list and end the turn, with no `AskUserQuestion` and no arming. The user picks by running the command again with a slug.

## Procedure

### Step 1 — Resolve the slot

Slot path is `~/.muggle-ai/muggle-do/sessions/<slug>/`. Refuse, one line each, when:

- **The dir is missing** — `no slot for <slug>; pass a PR URL to start one`.
- **The name ends in `.stopped`** — `<slug> was stopped by its owner; rename it back to adopt it`. Adoption is not a way around [`stop.md`](stop.md): the rename is the owner's kill switch, and honoring it here keeps that switch meaning one thing everywhere.
- **`result.md` exists** — `<slug> is finalized (<state>); nothing to watch`.
- **This session already owns it** — `<slug> is already owned by this session`, then run [`reconcile.md`](reconcile.md) scoped to that slug so a dead poller still gets recovered. Adopting what you own is a no-op, not an error.

With no slug, list every adoptable slot — open, not `.stopped`, owned by another session or none — as `<slug> → <owner>/<repo>#<n> (owner: <session-id | none>)`, then stop.

### Step 2 — Confirm the PR is still worth watching

Fetch the PR per [`../_shared/vcs/github/pr-metadata.md`](../_shared/vcs/github/pr-metadata.md) using `prs.json[0].url`.

- `MERGED` / `CLOSED` → do not adopt. Run [`finalize.md`](finalize.md) on the slot instead and say so: the slot needed closing out, not a watcher.
- `gh` fails → surface the error verbatim and stop. Never claim a slot whose PR cannot be read; the claim would strand it under a session that cannot poll it either.
- `open` → continue.

Refresh `prs.json[0].head_sha` to the current `headRefOid`. The branch has almost certainly moved since the original owner last looked.

### Step 3 — Warn about the context gap

State plainly, in one line, what adoption does not carry: `adopting <slug> — this session has none of the original session's context for #<n>; cycles will work from the PR and the diff alone.`

This is a statement, not a gate — the user asked. It exists because the failure it describes is silent: an adopted watcher looks identical to one this session armed, and the first sign of the gap is usually a reply that misreads why the code is the way it is.

### Step 4 — Claim and arm

Write `owner.json` ([`state-schemas.md`](state-schemas.md#ownerjson)) with `session_id` from `$CLAUDE_CODE_SESSION_ID` and `claimed_at` now, overwriting any previous owner. If `$CLAUDE_CODE_SESSION_ID` is unset, stop with `cannot adopt: no session id to record` — an unidentifiable owner leaves the slot recoverable by nobody.

Then arm per [`arm-watcher.md`](arm-watcher.md): one drain tick, then the persistent monitor. The drain is what makes the adoption honest — it acts on everything outstanding now, rather than resuming from a watermark seeded against a wave the original session read and this one never saw.

Append `adopted (from <previous-owner | unowned>)` to the slot's `followup.log`.

### Step 5 — Report

One line: `adopted <slug> → <owner>/<repo>#<n> — armed`.

## Invariants

- **Explicit only.** Adoption runs when the user names it. No sweep, hook, auto-track, or tick ever calls this procedure, and nothing offers it unprompted.
- **One slot per invocation.** No bulk adopt, no `--all`. Adopting every orphan in one command is the behavior the ownership gate exists to prevent, wearing a different name.
- **Stopped stays stopped.** A `.stopped` slot is unreachable here, as it is from every other recovery path.
- **Claim before arm.** `owner.json` is written before the monitor starts, so a crash between the two leaves a slot this session owns and can recover — never an armed watcher no session claims.
