# Session State Schemas

Canonical shapes for the JSON files in a PR-follow-up session slot. The slot path is `~/.muggle-ai/muggle-do/sessions/<slug>/` (under the user's home, shared across repos; `muggle-do` is the current and only caller).

All files are atomic writes — the caller rewrites the whole file each time, never mutates in place. Use a temp file + rename if the platform supports it.

## `prs.json`

A list of one entry. (Historical: the file is an array for forward-compat with the original session-wide model. Today, each PR has its own session slot, so the array always has exactly one entry.)

```json
[
  {
    "repo": "<owner>/<repo>",
    "number": <int>,
    "url": "https://github.com/<owner>/<repo>/pull/<number>",
    "head_sha": "<40-char-hex-sha>",
    "state": "open" | "merged" | "closed"
  }
]
```

- `state` is the **observed** state from the last `gh pr view`. The watcher refreshes it each tick.
- Terminal states (`merged`, `closed`) are sticky — once set, the watcher writes `result.md` and exits without rescheduling.

## `last_seen.json`

Keyed by `"<owner>/<repo>#<n>"`. One key per PR in the slot.

```json
{
  "<owner>/<repo>#<n>": {
    "reviewId": <int>,
    "last_pushed_sha": "<sha-or-null>",
    "idle_tick_count": <int>,
    "cycles_completed": <int>,
    "escalated_review_ids": [<int>, ...],
    "pushed_shas": ["<sha>", ...]
  }
}
```

- `reviewId`: the cursor. The watcher fetches reviews with `id > reviewId`. Bootstrap pins this to the highest existing submitted review id (or `0` if none).
- `last_pushed_sha`: most recent SHA `/muggle-do` pushed in this PR's life; `null` until the first push.
- `idle_tick_count`: incremented each tick that sees zero new reviews. Reset to 0 on any tick that dispatches `/muggle-do`. Diagnostic only — does not gate behavior.
- `cycles_completed`: incremented each time `/muggle-do` completes an address-reviews invocation (regardless of actionable/ambiguous/mixed).
- `escalated_review_ids`: review ids classified as ambiguous by `/muggle-do`. The watcher excludes these from future review fetches so the same ambiguous review is never re-dispatched.
- `pushed_shas`: every SHA `/muggle-do` has pushed for this PR. Append-only. Used by the resolve-reminder stage to recognize threads addressed by the loop.

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
2026-05-20T12:34:56Z tick pr=154 reviews_seen=0 idle
2026-05-20T12:35:56Z tick pr=154 reviews_seen=1 dispatched=4295962800
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

- <ISO-8601> bootstrap (cursor pinned at <reviewId>)
- <ISO-8601> review <id> from <login> — actionable, pushed <sha>
- <ISO-8601> review <id> from <login> — ambiguous, escalated
- ...
- <ISO-8601> PR <merged|closed> — watcher terminal
```

## Not in the slot

`cycle.json` and `requirements.md` are not seeded or read. `/muggle-do` reads reviews off GitHub each invocation.
