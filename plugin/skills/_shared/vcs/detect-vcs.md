# Detect VCS provider

Resolve a single provider token — `github` or `gitlab` — before a caller picks its recipe set. GitHub uses `gh`; GitLab uses `glab`. Auth errors from either surface verbatim.

## Resolution order

1. **From a URL argument**, if one was passed:
   - `github.com/<owner>/<repo>/pull/<n>` → `github`.
   - `<host>/<group>/<project>/-/merge_requests/<iid>` → `gitlab`. The `/-/merge_requests/` segment is the tell, on any host.

2. **From the repo**, when no URL — parse the origin remote:

   ```bash
   git remote get-url origin
   ```

   - Host `github.com` → `github`.
   - Host `gitlab.com`, **or** any other host where `glab auth status` succeeds → `gitlab`.

## GitLab wrinkles

- **Nested namespaces.** The path between host and `/-/` can be `group/subgroup/project`, any depth. Do not assume two segments — split on `/-/`, the project path is everything before it.
- **The `/-/` segment** separates the project path from the resource (`/-/merge_requests/<iid>`). GitHub has no equivalent; its `/pull/<n>` sits directly under `<owner>/<repo>`.
- **Self-hosted hosts.** GitLab is not just `gitlab.com` — `git.acme.com`, `gitlab.internal`, etc. Resolve the host from the remote and confirm it against `glab`'s configured host (`GITLAB_HOST`, or `glab auth status`'s active host). A remote host that matches `glab`'s host → `gitlab`, even when unknown to this doc.

## Output

The bare token `github` or `gitlab` — nothing else.
