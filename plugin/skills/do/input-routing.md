# Input routing

How `/muggle-do` resolves `$ARGUMENTS` to a mode. Modes 1–4 are programmatic — dispatched by the watcher — so never ask on those. A change-URL in modes 1–3 is either a GitHub PR (`github.com/.../pull/<n>`) or a GitLab MR (`<host>/.../-/merge_requests/<iid>`); provider is resolved via [`../_shared/vcs/detect-vcs.md`](../_shared/vcs/detect-vcs.md). Inspect in order:

1. **Address-reviews** — a PR/MR URL **and** an address-reviews directive carrying review/discussion ids → [`address-reviews.md`](address-reviews.md). On GitHub these ids are integers ≥ 100000000; that magnitude is GitHub-specific lore, **not** a portable test. Under GitLab, tell this apart from other directives by the directive keyword plus the presence of discussion ids, never by id size.
2. **Fix-CI** — a PR/MR URL **and** a `fix ci` / `fix-ci` directive with failing check names (no review/discussion ids) → [`fix-ci.md`](fix-ci.md).
3. **Rebase** — a PR/MR URL **and** a `rebase` directive (or legacy `resolve conflicts` / `resolve-conflicts`; no review/discussion ids, no check names) → [`resolve-conflicts.md`](resolve-conflicts.md). Rebases the branch onto its base whether it's merely behind or actually conflicting.
4. **Post-merge cleanup** — a `cleanup` token and `slug=<slug>` (no PR URL, no review ids), optionally `state=<merged|closed>` (default `merged`) → [`cleanup.md`](cleanup.md).
5. **Empty / `help` / `menu` / `?`** → menu + session selector.
6. **Task automation** (perform an action on a website) → `muggle:muggle-browser-task`.
7. **Otherwise** → forward pipeline at Stage 1.

When in doubt between #6 and #7, ask one question.
