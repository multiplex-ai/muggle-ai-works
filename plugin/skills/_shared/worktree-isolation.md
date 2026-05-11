# Worktrees

Single source of truth for **(a)** the [`autoUseWorktree`](../muggle-preferences/preference-gates/autoUseWorktree.md) gate decision and **(b)** the per-worktree setup mechanics that any multi-branch session needs. Other skills reference this doc rather than restating the rules.

## When to create a worktree (single-PR case — `autoUseWorktree` gate)

Follow the standard gate procedure in [`preference-gates/README.md`](../muggle-preferences/preference-gates/README.md). **Fire the gate only when** the current checkout is not already a worktree (`git rev-parse --is-inside-work-tree`, inspect `git worktree list`) **and** the work is more than a trivial edit. Otherwise skip — no picker, no footer.

On `always`, defer worktree creation to `superpowers:using-git-worktrees`. The setup checklist below applies once the worktree exists.

## When to iterate worktrees (multi-branch case)

Any time you're iterating a **set** of branches in one session and each needs an independent dev server, an independent install, and an isolated working tree:

- PR loop (acceptance-test every open PR sequentially)
- Regression sweep across recent merges
- Before/after comparison between two refs
- Multi-branch reproduction of a flaky issue

The rules below apply per worktree, in addition to the single-PR gate above.

## The pattern

- **One worktree per branch.** Never reuse a long-lived checkout across branches. Dev servers (CRA, Vite, Next.js) tie to a single directory; switching branches under a running server doesn't hot-reload cleanly and produces stale bundles.
- **Sequential execution, not parallel,** when worktrees share resources — a single dev-server port, a single test user account, a single shared local DB. Parallelism without per-worktree resource pools causes flaky cross-test interference that looks like real failures.
- **Tear down each worktree** after its result is posted before moving to the next. Stop the dev server → remove the worktree → prune dangling refs. Keeping old worktrees around wastes disk and leaves stale dev servers running.

## Files that must cross the worktree boundary

`git worktree add` only checks out tracked files. Two gitignored things the dev server and subagents need:

- **The env file the dev server reads at boot.** Per-repo: `.env`, `.env.local`, `.env.development`, `.env.dev`, `.env.test`, or framework-specific equivalents (Next.js, Vite, CRA each have their own conventions). Inspect `package.json` scripts and framework config (`next.config.*`, `vite.config.*`) to determine which file this repo uses. Without it, the dev server binds the framework default port or fails to read secrets.
- **`.muggle-ai/`** — cached `last-project.json` and `last-host.json`. Lets subagents skip the project + host pickers; without it, every dispatched subagent re-prompts and the loop stalls.

Copy from the main worktree right after `git worktree add`:

```bash
cp <main>/<envfile> <new>/<envfile>
cp -r <main>/.muggle-ai <new>/.muggle-ai
```

Copy, don't symlink — concurrent loops must not trample each other through a shared cache.

## Per-worktree `npm install` — never symlink `node_modules`

Each worktree must run its own real install:

```bash
npm install --prefer-offline --no-audit --no-fund
```

Warm npm cache makes this ~30s. **Do not symlink `node_modules/`** from the main checkout, even though it's tempting for speed.

**Why symlinking breaks the build:** webpack's `resolve.symlinks: true` (the default) follows symlinks and rewrites paths to the real on-disk location. When `node_modules` resolves to a path shared across worktrees, webpack's asset-identity tracking fires the error:

```
Can't handle conflicting asset info for sourceFilename
```

Most reproducibly seen on font assets like `@fontsource/roboto/files/roboto-cyrillic-*.woff2`, where two webpack compilations resolve the same real file under two different module IDs. Setting `resolve.symlinks: false` is not a fix — it breaks other tooling. A real per-worktree install is.

## Port-kill helpers (cross-platform)

Before starting a fresh dev server in a new worktree, kill anything still bound to the port from the previous iteration. Don't assume clean shutdown — orphaned `node` processes from earlier dispatches are common.

**Windows PowerShell:**

```powershell
Get-NetTCPConnection -LocalPort <port> -ErrorAction SilentlyContinue |
  ForEach-Object {
    try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    catch { }
  }
```

**POSIX (Linux / macOS):**

```bash
lsof -ti:<port> 2>/dev/null | xargs -r kill -9
```

Both forms are silent on "nothing to kill" — that's intentional, the loop shouldn't crash on an empty port.

## Cleanup order

After the verdict is posted for the current PR, tear down before moving to the next:

1. **Stop the dev server** — port-kill (above). Don't rely on `kill <pid>` from when you launched it; backgrounded npm scripts often spawn children that survive.
2. **Remove the worktree** — `git worktree remove --force <path>` (or `rm -rf <path>` if the first errors).
3. **Prune dangling refs** — `git worktree prune` to clean up entries for the now-removed directory.

If `rm -rf` reports **"Device or resource busy"** on Windows (node still holds file handles to compiled assets), wait a few seconds and retry, or skip the `rm -rf` and just call `git worktree prune` — the prune succeeds either way and leaves only an empty directory behind that the next loop iteration ignores.
