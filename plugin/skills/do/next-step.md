# Next-Step Suggestion

Closing step of a terminal `/muggle-do` turn (post-merge or post-close). Advances silently when the session still has a plan, stops and asks when it doesn't.

## Input

- `slug` — the session.
- `teardownRan` — whether [`cleanup.md`](cleanup.md) already ran teardown (true on `merged` + `autoCleanup: always`; false on `closed` or a skipped gate).

## Procedure

1. Read the session plan — the current session's TodoWrite list.
2. **Pending items remain** → do not prompt. Append `next-step: plan has <N> pending — advancing` to `followup.log` and continue to the next pending item. The user set a course; honor it.
3. **No pending items** → stop and ask for directions with one `AskUserQuestion` selector:
   - **Clean up now** — offer only when `teardownRan` is false (a `closed` PR, or `merged` with `autoCleanup` not `always`). Runs the shared teardown [`../_shared/post-merge-cleanup.md`](../_shared/post-merge-cleanup.md) for this slug, under its own safety rules.
   - **Move on / next task** — start a fresh `/muggle-do` forward run, or pick another open session.
   - **Done — stop here** — exit with no further action.
4. Append the chosen outcome to `followup.log`.
