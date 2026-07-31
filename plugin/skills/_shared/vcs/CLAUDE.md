# VCS provider recipes

Provider-agnostic seam for the watcher and dev-cycle skills. A caller resolves one provider token via [`detect-vcs.md`](detect-vcs.md) — `github` (`gh`) or `gitlab` (`glab`) — then loads the matching provider's recipe for each agnostic step. The two recipe sets mirror each other call-for-call; callers branch on the token, never fork procedure. Provider-agnostic entry points live once in `common/`, indexed by both TOCs: a **dispatcher** owns the `github`-vs-`gitlab` branch so a caller links it alone instead of naming both recipes side by side (`ci-rollup`, `branch-standing`, `push-to-branch`), and a recipe with no provider-specific procedure lives there too (`verify-working-tree`).

## Index

- [`detect-vcs.md`](detect-vcs.md) — resolve `github` | `gitlab` from a URL argument or the origin remote.
- [`github.md`](github.md) — `gh` / `git` recipe TOC; per-recipe files in [`github/`](github/).
- [`gitlab.md`](gitlab.md) — `glab` / `git` recipe TOC; per-recipe files in [`gitlab/`](gitlab/).
- `common/` — provider-agnostic entry points (`ci-rollup`, `branch-standing`, `push-to-branch`, `verify-working-tree`), indexed by both provider TOCs.
