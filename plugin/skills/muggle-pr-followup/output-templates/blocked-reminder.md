# Blocked reminder

The watcher's one-line nudge to the loop owner, emitted every tick a PR sits blocked pending a human ([`../contract.md`](../contract.md) Steps 2.5 / 7). It goes to the **session** — the owner running the loop — never to the PR, so it never notifies the GitHub reviewer. Keep it to **one line**: the pending act plus a reference to trace back to the decision context.

## Shape

```
⏳ <owner>/<repo>#<n> awaiting you (<duration>): <pending act>. → <reference>
```

- `<duration>` — how long the block has stood, from `last_seen.blocked.since` (e.g. `2h`, `1d`).
- `<pending act>` — the one thing the owner must do, keyed by `reason`.
- `<reference>` — where to trace the decision back to: the review, the PR checks, or the blocked SHA.

## By reason

- **`reviews_escalated`** — an ambiguous review awaits your direction:
  ```
  ⏳ acme/widget#142 awaiting you (2h): pick a direction on ambiguous review #<id> from <login>. → reply on the review or tell me here: <review-url>
  ```
- **`conflict_escalated`** — a rebase the loop gave up on:
  ```
  ⏳ acme/widget#142 awaiting you (2h): resolve the rebase conflict on <short-sha> (autoResolveConflicts=never), then push — or set the pref to always. → <pr-url>
  ```
- **`ci_escalated`** — the CI fix budget is spent:
  ```
  ⏳ acme/widget#142 awaiting you (2h): the failing checks on <short-sha> need your call — fix and push, or advise here. → <pr-url>/checks
  ```
- **`ci_escalated` with `last_seen.e2e_decision` on this head** — E2E cases the repair loop could not fix. Name every case with its bucket and failing step, then the four options; never the generic CI line, which hides the decision:
  ```
  ⏳ acme/widget#142 awaiting you (2h): E2E on <short-sha> — Billing debit shows tokens (test-precondition, step 4), Checkout (infra, step 2) — reply: repair <direction> | feedback+rerun | waive | stop. → <pr-url>/checks
  ```
  Every case `waived: true` → the user already decided; say so instead of asking again:
  ```
  ⏳ acme/widget#142 awaiting you (2h): muggle-walkthrough stays red on <short-sha> only for cases you waived (Checkout) — merge past it, or re-run E2E. → <pr-url>/checks
  ```

The reminder repeats every blocked tick (at the normal `1m` cadence) until the owner acts; the watcher stops it the moment the fingerprint moves (a push, a new review, a CI/deploy change, or a new conversation comment).
