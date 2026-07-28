# Session State Schemas

Canonical shapes for the JSON files in a PR-follow-up session slot. The slot path is `~/.muggle-ai/muggle-do/sessions/<slug>/` (under the user's home, shared across repos; `muggle-do` is the current and only caller).

All files are **whole-file atomic writes** — rewrite the entire file each time, never a partial Edit. The mechanism (tool-based, OS-agnostic) and the reason Edit fails on these files live in [`../_shared/session-state-writes.md`](../_shared/session-state-writes.md).

## Legacy location

Before the move to the user's home, slots lived at the repo-relative `.muggle-do/sessions/<slug>/` (one per working tree, still gitignored). Bootstrap's Step 5 migrates a legacy slot to the home-dir location on the next run for that PR; nothing else reads the old path. The state is ephemeral and reconstructible from GitHub, so an un-migrated slot costs only a re-bootstrap, not data.

## `prs.json`

A list of one entry. (Historical: the file is an array for forward-compat with the original session-wide model. Today, each PR has its own session slot, so the array always has exactly one entry.)

```json
[
  {
    "repo": "<owner>/<repo>",
    "provider": "github" | "gitlab",
    "number": <int>,
    "url": "https://github.com/<owner>/<repo>/pull/<number>",
    "head_sha": "<40-char-hex-sha>",
    "state": "open" | "merged" | "closed"
  }
]
```

- `provider` selects the recipe set (`gh` vs `glab`). Absent ⇒ `github` — existing slots predate the field and stay GitHub.
- Under GitLab, `number` holds the MR `iid` (per-project, not the global MR id); `head_sha` is unchanged. GitLab's `opened` normalizes to `open`; `merged` and `closed` already align.
- `state` is the **observed** state from the last `gh pr view`. The watcher refreshes it each tick.
- Terminal states (`merged`, `closed`) are sticky — once set, the watcher writes `result.md` and exits without rescheduling.

## `cron.json`

A durable, on-disk handle to this slot's watcher cron. Its whole reason to exist: `CronList` goes **blind to crons that outlive a session continue / compaction** (the watcher's `/loop` cron survives, but the tool can no longer enumerate it), so a teardown that can only find crons through `CronList` can never delete the orphan — it re-fires until the 7-day `/loop` expiry. A cron id recorded to disk **while the cron was still visible** stays a valid `CronDelete` target afterward. See [`record-cron-id.md`](record-cron-id.md) (who writes it) and [`cancel-cron.md`](cancel-cron.md) (who deletes by it).

```json
{
  "cron_id": "<scheduler-id-or-null>",
  "command": "/muggle:muggle-pr-followup <slug> <n>",
  "interval": "1m",
  "recorded_at": "<ISO-8601>"
}
```

- `cron_id`: the scheduler id of the live `/loop` cron for this slot. Bootstrap seeds `null` (it dispatches `/loop` as its last action and cannot yet see the id); the first tick self-records the real id per [`record-cron-id.md`](record-cron-id.md). `null` again for the one tick after `/muggle-do` respawns the watcher (a dispatch cancels the old cron and the respawn arms a new one whose id is unknown until the next tick observes it).
- `command`: the exact two-arg dispatch, the same string [`cancel-cron.md`](cancel-cron.md) matches on as its `CronList` fallback.
- `interval`: the poll cadence — always `1m`. The watcher polls at `1m` whether or not the PR is blocked; a blocked PR reminds at `1m`, it does not back off (see [`blocked-tick.md`](blocked-tick.md) and [`contract.md`](contract.md) Steps 2.5 / 7). Recorded for teardown/forensics.

## `last_seen.json`

Keyed by `"<owner>/<repo>#<n>"`. One key per PR in the slot.

```json
{
  "<owner>/<repo>#<n>": {
    "lastBodyReviewId": <int>,
    "last_pushed_sha": "<sha-or-null>",
    "idle_tick_count": <int>,
    "cycles_completed": <int>,
    "escalated_review_ids": [<int>, ...],
    "pushed_shas": ["<sha>", ...],
    "ci_fix_attempts": { "<sha>": <int> },
    "ci_escalated_shas": ["<sha>", ...],
    "conflict_resolve_attempts": { "<head-sha>..<base-tip-sha>": <int> },
    "conflict_escalated_keys": ["<head-sha>..<base-tip-sha>", ...],
    "blocked": {
      "reason": "conflict_escalated" | "ci_escalated" | "reviews_escalated",
      "since": "<ISO-8601>",
      "fingerprint": {
        "head_sha": "<sha>",
        "latest_review_id": <int>,
        "ci_digest": "<string>"
      }
    }
  }
}
```

- `lastBodyReviewId`: narrow watermark for **body-only** reviews (a submitted review carrying no line comments). The watcher dispatches a body-only review only when `id > lastBodyReviewId`. Line-comment threads do **not** use it — they are dispatched from live thread state (unresolved + not outdated + newest comment unmarked by the loop), so there is no cursor that can pin past them. Bootstrap sets it to the highest existing submitted review id with `--forward-only`, else `0`. The cursor keeps its name under GitLab, where it holds the highest note / discussion id.
- `last_pushed_sha`: most recent SHA `/muggle-do` pushed in this PR's life; `null` until the first push.
- `idle_tick_count`: incremented each tick whose actionable set is empty. Reset to 0 on any tick that dispatches `/muggle-do`. Diagnostic only — does not gate behavior.
- `cycles_completed`: incremented each time `/muggle-do` completes an address-reviews invocation (regardless of actionable/ambiguous/mixed).
- `escalated_review_ids`: review ids classified as ambiguous by `/muggle-do`. The watcher excludes these from the actionable set (both body-only reviews and the threads they own) so the same ambiguous review is never re-dispatched.
- `pushed_shas`: every SHA `/muggle-do` has pushed for this PR. Append-only. Used by the resolve-reminder stage to recognize threads addressed by the loop.
- `ci_fix_attempts`: per-SHA count of fix-ci cycles `/muggle-do` has run. The watcher stops dispatching fix-ci for a SHA once its count reaches 3. Keyed by head SHA.
- `ci_escalated_shas`: head SHAs whose CI the fix-ci stage gave up on (attempts exhausted or only out-of-scope checks). The watcher excludes these from CI dispatch so a hopeless SHA is never re-fixed.
- `conflict_resolve_attempts`: count of rebase cycles `/muggle-do` has run (behind-only or conflicting — both rebase onto the base). The watcher stops dispatching once a key's count reaches 2. Keyed by `rebase_key` — `"<head_sha>..<base_tip_sha>"`, the head paired with the base branch tip it was measured against.
- `conflict_escalated_keys`: `rebase_key`s whose rebase `/muggle-do` gave up on (attempts exhausted, or a conflict under `autoResolveConflicts=never`). The watcher excludes these from rebase dispatch so a hopeless pairing is never re-attempted.

Both are keyed on the pair, not the head alone, because whether a branch conflicts depends on both sides. Under a head-only key, a base that moves produces a genuinely new conflict against an unchanged head — and the stale entry suppresses it permanently, because nothing can change the head while the branch sits blocked. Pairing re-arms the budget whenever either side moves. Legacy entries written before this change are bare SHAs with no `..`; readers ignore them, which un-wedges any slot they had blocked.

Unlike these, `ci_fix_attempts` / `ci_escalated_shas` stay keyed on the head SHA alone — a CI result is a function of the head only, so base movement must not re-arm them.
- `blocked`: present only while the watcher is **awaiting the owner** on a PR that cannot progress without a human ([`contract.md`](contract.md) Step 7). Absent ⇒ the watcher is in its normal dispatch flow. When present, the watcher **keeps the normal `1m` cadence** and each tick is a reminder-or-resume check ([`contract.md`](contract.md) Step 2.5): it re-emits a one-line reminder to the owner, recomputes the `fingerprint`, and clears the block the moment any component moves. Its value is the reason-specific reminder plus fingerprint auto-resume.
  - `reason`: which durable block is being awaited — `conflict_escalated` (`rebase_key` ∈ `conflict_escalated_keys`), `ci_escalated` (`head_sha` ∈ `ci_escalated_shas`), or `reviews_escalated` (a review sits in `escalated_review_ids` awaiting the user, actionable set empty). Selects the reminder wording; the resume decision is fingerprint-driven, not reason-driven.
  - `since`: when the block was first flagged — lets the reminder state how long the owner has been the blocker.
  - `fingerprint`: the external state the block is waiting on. `head_sha` moves on a new push (which also clears the per-SHA escalation sets, keyed by SHA); `latest_review_id` is `max(id)` over submitted reviews and moves when a reviewer submits anything new; `ci_digest` is a stable digest of the head SHA's CI rollup (bucket + each check's name/conclusion, sorted) and moves when a check flips, a rerun lands, or an external check such as a staging deploy posts. Any change clears the block and resumes evaluation.

## `state.md`

Free-form markdown. No required schema beyond a few well-known fields the caller-agnostic code reads:

```markdown
# Session — <slug>

**PR:** <url>
**Slug:** <slug>
**Loop user:** <github-login>          ← cached from `gh api user`
**Created:** <ISO-8601>
**Bootstrapped from URL:** <yes | no>

## Pre-flight answers

- Validation: <local-e2e | staging-replay | unit-only | skip>
- Local URL: <url | N/A>
- Backend status: <up | down | N/A>
- Muggle Test project: <name> (<uuid>)
- Test credentials: <existing | new | skip>
- Auth status: <ok | re-authed | N/A>
- Working tree: <path>

...free-form notes added by /muggle-do and bootstrap...
```

The `## Pre-flight answers` block is the **E2E validation context** consumed by `do/e2e-acceptance.md` Step 0 — seeded by bootstrap (Step 6.5) or by pre-flight's output block. Fields: [`../_shared/resolve-e2e-validation-context.md`](../_shared/resolve-e2e-validation-context.md#persisted-fields).

The watcher does **not** read or write `state.md`. Only bootstrap, `/muggle-do`, and the caller's stages touch it.

## `followup.log`

Append-only line-per-tick log. One line per watcher tick, plus one line per `/muggle-do` invocation. Format is loose, but each line starts with an ISO-8601 timestamp:

```
2026-05-20T12:34:56Z tick pr=154 threads=0 idle
2026-05-20T12:35:56Z tick pr=154 threads=1 dispatched=4295962800
2026-05-20T12:36:14Z muggle-do cycle review_ids=[4295962800] outcome=pushed head_sha=abc1234
```

Used for forensics only — never read back by skills.

## `result.md`

Written exactly once when the PR's watcher exits terminally (PR merged or closed). Free-form markdown summarizing the PR's life under this loop:

```markdown
# Result — <slug>

**PR:** <url>
**Final state:** merged | closed
**Cycles completed:** <int>
**Pushed SHAs:** <comma-separated list>
**Escalated review ids:** <comma-separated list or "none">

## Timeline

- <ISO-8601> bootstrap (lastBodyReviewId <id>; line-comment threads state-derived)
- <ISO-8601> review <id> from <login> — actionable, pushed <sha>
- <ISO-8601> review <id> from <login> — ambiguous, escalated
- ...
- <ISO-8601> PR <merged|closed> — watcher terminal
```

## Not in the slot

`cycle.json` and `requirements.md` are not seeded or read. `/muggle-do` reads reviews off GitHub each invocation.

## `watch-heartbeat`

Touched (mtime refreshed) by the watch loop every iteration — content irrelevant. The slot's liveness beacon: a quiet monitor writes no log lines, so mtime is the only proof it is still polling. Read by [`reconcile.md`](reconcile.md) Step 3.6 and the out-of-session watchdog; a beacon older than 15 minutes means the poller is dead.

## `watchdog.json`

The out-of-session watchdog's per-slot spawn ledger ([`reconcile.md`](reconcile.md#out-of-session-watchdog)). Written only by the watchdog daemon; no skill reads it.

```json
{
  "pending_signature": "<signal-signature-or-null>",
  "pending_seen_at": "<ISO-8601-or-null>",
  "last_spawn_signature": "<signal-signature-or-null>",
  "last_spawn_at": "<ISO-8601-or-null>",
  "spawn_attempts": <int>
}
```

- `pending_signature` / `pending_seen_at`: a non-terminal signal must be observed on two consecutive scans before it spawns a recovery tick — this pair records the first sighting.
- `last_spawn_signature` / `last_spawn_at`: the last spawned signature. Unchanged signature + a `followup.log` line newer than `last_spawn_at` (the tick ran) ⇒ never re-spawn; no newer line ⇒ the spawn died silently (usage limit) and is retried after a backoff window.
- `spawn_attempts`: lifetime spawn count, forensics only.

## `watch-watermark.env`

The watch loop's comparison floor — plain `KEY=VALUE` lines, one file per slot:

- `REV` — highest submitted-review id already handled
- `COM` — highest thread-comment id already handled
- `THREADS` — semicolon-joined ids of threads already known unresolved
- `CIRED` — head SHA whose settled-red CI the drain already handled; empty when the checks are green, still pending, or unseen. The CI floor is a SHA rather than a monotonic id because the check rollup flips green↔red and resets on each push — keying on the head SHA fires the loop once per red head and re-arms on the next push ([`arm-watcher.md`](arm-watcher.md)).

Written whole-file by the orchestrating session — seeded at arm time from a post-drain fetch, advanced after every cycle from a post-replies fetch. Read by the watch loop each iteration; the loop never writes it. A stale watermark makes the next reported event the loop's own reply ([`arm-watcher.md`](arm-watcher.md)).

**Never `source` this file, and quote or extract values.** `THREADS` holds bare semicolons: sourced unquoted, the shell splits the line at the first `;` and silently drops every id after it — the loop then re-reports known threads as new. The watch loop must extract values verbatim (e.g. `grep '^THREADS=' | cut -d= -f2- | tr -d '"\r'`), tolerating quotes and CRLF; writers should quote the value anyway.

## `watch.pid`

A single line: the process id of the watch loop that currently owns this slot. Written once by the loop itself on start (`echo "$$" > watch.pid`); read by two parties, never rewritten in place:

- **arm-watcher's pre-arm dedup** ([`arm-watcher.md`](arm-watcher.md) Step 3) reads it and, if the PID is live (`kill -0`), skips arming — one live watcher per slot.
- **the loop's own supersede guard** (`watcher_superseded`, [`../../scripts/pr-watch-guards.sh`](../../scripts/pr-watch-guards.sh)) compares it to `$$` each iteration and exits when they differ — a newer arm that overwrote the file steps the old loop down.

This is the lease that keeps orphaned watchers from accumulating across sessions: the in-session monitor task dying does not stop the detached OS loop it launched (notably on Windows), so slot ownership is tracked by a durable PID on disk, not by the live task list. It is not seeded, migrated, or cleaned up — a stale PID (loop already dead) simply fails the `kill -0` liveness check and the next arm proceeds.
