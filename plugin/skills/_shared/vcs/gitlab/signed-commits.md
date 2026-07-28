# Signed commits without local signing

**Never push unsigned commits.** GitLab has no server-side signing analogue — commits created through its commits API are unsigned, so a broken local signing setup has no remote route around it. And never "fix" a signing failure by disabling it: no `--no-gpg-sign`, no `-c commit.gpgsign=false`.

## Preflight

```bash
git -C <repo-path> log --format='%G?' origin/<branch>..HEAD   # unpushed branch: <base>..HEAD
```

Any `N` (no signature) among the commits about to leave the machine → the push is blocked. `G`/`E`/`U` are signed commits (locally unverifiable is fine). Signing configured and working → commit and push normally.

## Blocked

Unsigned commits bound for an MR branch → stop and escalate to the owner to configure local signing. A local rebase mints new unsigned commits, so the force-push path is equally blocked. Never push unsigned.
