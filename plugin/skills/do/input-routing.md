# Input routing

How `/muggle-do` resolves `$ARGUMENTS` to a mode. Modes 1–3 are programmatic — dispatched by the watcher — so never ask on those. Inspect in order:

1. **Address-reviews** — a `github.com/.../pull/<n>` URL **and** one or more review ids (integers ≥ 100000000) → [`address-reviews.md`](address-reviews.md).
2. **Fix-CI** — a `github.com/.../pull/<n>` URL **and** a `fix ci` / `fix-ci` directive with failing check names (no review ids) → [`fix-ci.md`](fix-ci.md).
3. **Post-merge cleanup** — a `cleanup` token and `slug=<slug>` (no PR URL, no review ids), optionally `state=<merged|closed>` (default `merged`) → [`cleanup.md`](cleanup.md).
4. **Empty / `help` / `menu` / `?`** → menu + session selector.
5. **Task automation** (perform an action on a website) → `muggle:muggle-browser-task`.
6. **Otherwise** → forward pipeline at Stage 1.

When in doubt between #5 and #6, ask one question.
