# Push to branch (tool-agnostic)

**This is the tool-agnostic instruction for pushing commits to a branch.** All commit/push sites in skills reference this file, never embed the logic inline — single source of truth.

## Signing gate — never push unsigned commits

Before pushing, verify the commits about to leave the machine are signed. Use the resolved provider's preflight per [`../detect-vcs.md`](../detect-vcs.md):

- **`github`** — follow [`../github/signed-commits.md`](../github/signed-commits.md). If local signing works, push normally. If not, use the remote-signed path (createCommitOnBranch) instead of pushing unsigned.
- **`gitlab`** — follow [`../gitlab/signed-commits.md`](../gitlab/signed-commits.md). If local signing is broken, stop and escalate — GitLab has no server-side signing analogue.

Never disable signing to make a push go through (`--no-gpg-sign`, `-c commit.gpgsign=false`).

## Push

For the resolved provider, execute per its signed-commits recipe:

- `github` with working local signing → standard push: `git push origin <branch>` (or `git push -u origin <branch>` for new branches).
- `github` without working local signing → createCommitOnBranch path ([see recipe](../github/signed-commits.md#remote-signed-commit)); push is skipped (commits already on remote).
- `gitlab` with working local signing → standard push: `git push origin <branch>` (or `git push -u origin <branch>`).
- `gitlab` without working local signing → escalate per [`../gitlab/signed-commits.md`](../gitlab/signed-commits.md).

Capture the new SHA: `git rev-parse HEAD` (local mode) or from the remote mutation response (createCommitOnBranch). Append to `last_seen.pushed_shas[]` so resolve-reminder can recognize it.
