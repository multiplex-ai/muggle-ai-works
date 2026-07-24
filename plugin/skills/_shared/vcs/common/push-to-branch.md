# Push to branch (tool-agnostic)

The single instruction every commit/push site references — sites link here and never embed provider commands inline.

## Signing gate — never push unsigned commits

Resolve the provider per [`../detect-vcs.md`](../detect-vcs.md), then run its signed-commits recipe — the recipe owns the preflight and the actual commands:

- `github` → [`../github/signed-commits.md`](../github/signed-commits.md) — local signing working: commit and push normally; broken: create the commits server-signed (`createCommitOnBranch`) and skip the push (the remote already has them). Rebase/force-push follows the same recipe's replay path.
- `gitlab` → [`../gitlab/signed-commits.md`](../gitlab/signed-commits.md) — local signing working: commit and push normally; broken: stop and escalate (no server-side signing).

Never disable signing to make a push go through.

## After the push

Capture the new head SHA — from the local branch, or from the mutation response on the server-signed path — and append it to `last_seen.pushed_shas[]` so resolve-reminder can recognize it.
