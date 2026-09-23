# `maxCatchUpRebases`

How many catch-up rebases `muggle-pr-followup` runs on one pull request before it stops and hands the branch back to its owner.

**Not gated.** This is a configuration value — no Picker 1, no silent footer. Nothing prompts; the saved value is read by the tick each time a rebase comes due. The `muggle-preferences` skill exposes it through Configure and Set so users can change it.

| Value | Budget |
|:------|:-------|
| `10` | Ten catch-up rebases per PR |
| `20` | Twenty — default |
| `50` | Fifty |
| `never` | Unbounded |

## Why a bound exists

`conflict_resolve_attempts` caps retries of one `rebase_key` — `<head_sha>..<base_tip_sha>` — at 2, and that key changes every time the base branch moves. A base taking several merges a day therefore resets the pair-keyed budget on every advance, so it can never stop anything: the PR is rebased for as long as it stays open. Each rebase rewrites the head, which discards the CI already run against it and re-opens the window for a fresh conflict, so a busy base can outrun the branch indefinitely.

`catch_up_rebases` counts the PR's whole life and no key resets it. It is the only cap that binds.

## Exhaustion

Reaching the cap is an escalation, not a quiet stop. The tick sets `rebase_budget_exhausted`, blocks the watch with reason `rebase_budget_exhausted`, and reports the count, the cap, and this key on the PR. A branch rebased twenty times is not converging, and its owner needs to hear that while it is still true rather than find a stale PR days later.

This is the one block reason that does not clear on a fingerprint move. Base movement is what spent the budget, so resuming on it would restore the unbounded loop. It clears when the owner raises the cap or the PR goes terminal.

## Applying it

Resolved by the session at tick time, which can read preferences, through `CATCH_UP_REBASE_BUDGET` in `packages/mcps/src/shared/catch-up-rebase-constants.ts`. Absent or unparseable → `20`. `never` maps to `0`, which the tick reads as unbounded — the same convention `watcherLifetime` uses.
