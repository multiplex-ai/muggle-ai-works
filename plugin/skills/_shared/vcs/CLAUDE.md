# VCS provider recipes

Provider-agnostic seam for the watcher and dev-cycle skills. A caller resolves one provider token via [`detect-vcs.md`](detect-vcs.md) — `github` (`gh`) or `gitlab` (`glab`) — then loads the matching provider's recipe for each agnostic step. The two recipe sets mirror each other call-for-call; callers branch on the token, never fork procedure.

## Index

- [`detect-vcs.md`](detect-vcs.md) — resolve `github` | `gitlab` from a URL argument or the origin remote.
- [`github.md`](github.md) — `gh` / `git` recipe TOC; per-recipe files in [`github/`](github/).
- [`gitlab.md`](gitlab.md) — `glab` / `git` recipe TOC; per-recipe files in [`gitlab/`](gitlab/).
