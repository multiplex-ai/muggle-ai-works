# Input routing

How `/muggle-do` resolves `$ARGUMENTS` to a mode. Modes 1–4 are programmatic — dispatched by the watcher — so never ask on those. Inspect in order:

1. **Address-reviews** — a `github.com/.../pull/<n>` URL **and** one or more review ids (integers ≥ 100000000) → [`address-reviews.md`](address-reviews.md).
2. **Fix-CI** — a `github.com/.../pull/<n>` URL **and** a `fix ci` / `fix-ci` directive with failing check names (no review ids) → [`fix-ci.md`](fix-ci.md).
3. **Resolve-conflicts** — a `github.com/.../pull/<n>` URL **and** a `resolve conflicts` / `resolve-conflicts` directive (no review ids, no check names) → [`resolve-conflicts.md`](resolve-conflicts.md).
4. **Post-merge cleanup** — a `cleanup` token and `slug=<slug>` (no PR URL, no review ids), optionally `state=<merged|closed>` (default `merged`) → [`cleanup.md`](cleanup.md).
5. **Empty / `help` / `menu` / `?`** → menu + session selector.
6. **Task automation** (perform an action on a website) → `muggle:muggle-browser-task`.
7. **Otherwise** → forward pipeline at Stage 1.

When in doubt between #6 and #7, ask one question.
