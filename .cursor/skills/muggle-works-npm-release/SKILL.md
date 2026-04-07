---
name: muggle-works-npm-release
description: >-
  Guided @muggleai/works release: ask major/minor/patch, gather npm + Electron
  versions and confirm, then edit package.json, PR, merge, and trigger CI
  publish (publish-works-to-npm.yml)—no local npm publish.
---

# Muggle Works — npm release

## Phase 1 — Ask bump type (do this first)

**Stop until the user answers.** Ask explicitly:

> Is this release a **major**, **minor**, or **patch** (fix)?

Optional: use **AskQuestion** with those three choices. Do **not** assume; do **not** edit files yet.

---

## Phase 2 — Collect, print, confirm

1. **npm**
   - Read **`npm view @muggleai/works version`** (last published).
   - Read root **`package.json` → `version`** on the default branch / current checkout.
   - **Baseline** for the next publish = **semver-higher** of those two (so you never target a version below what is already in the repo or on npm).
   - Apply the user’s **major / minor / patch** choice to that baseline to get **`nextNpmVersion`** (e.g. with `npm version` locally on a throwaway copy, or a small semver helper—must be correct semver).

2. **Electron**
   - Read **`package.json` → `muggleConfig.electronAppVersion`** (current bundled desktop).
   - **Latest desktop on GitHub:** from  
     `https://api.github.com/repos/multiplex-ai/muggle-ai-works/releases?per_page=30`  
     take the newest **`tag_name`** matching **`electron-app-v*`** and strip the prefix → **`latestElectronVersion`** (semver only, no extra `v`).

3. **Print a short summary** (always):
   - Last published **@muggleai/works** on npm  
   - **Baseline** used for the bump  
   - **nextNpmVersion** (to publish)  
   - **Current** `electronAppVersion` in `package.json`  
   - **Latest** Electron release **`electron-app-v…`** from GitHub  

4. **If** `latestElectronVersion` ≠ current `electronAppVersion`, ask whether to **bump Electron + checksums** to **`latestElectronVersion`** or **keep** the current one. If bumping: checksums come from  
   `https://github.com/multiplex-ai/muggle-ai-works/releases/download/electron-app-vVERSION/checksums.txt`  
   map zips → `darwin-arm64`, `darwin-x64`, `win32-x64`, `linux-x64` (same rules as today).

5. **Stop again:** ask the user to **confirm** the full plan (**nextNpmVersion** + Electron choice) before any writes.

---

## Phase 3 — After explicit confirmation only

1. **Edits (repo: `muggle-ai-works`)**
   - Set **`package.json` → `version`** to **`nextNpmVersion`**.
   - If Electron bump agreed: set **`muggleConfig.electronAppVersion`** and all four **`muggleConfig.checksums`**.
   - Run **`pnpm run build`** (syncs plugin/marketplace manifests via `sync-versions`).
   - Run **`pnpm run verify:electron-release-checksums`**.

2. **Git**
   - Branch: e.g. **`chore/release-works-{nextNpmVersion}`** (replace dots if needed).
   - Commit with a clear message (version + Electron if changed).
   - **`git push -u origin …`**, **`gh pr create`** into **`master`**, **`gh pr merge`** (squash is fine unless the repo prefers merge commits).
   - **`git checkout master`** && **`git pull`** so you are on merged **`master`**.

3. **Trigger publish** (no local **`npm publish`**)
   - Prefer **`gh workflow run publish-works-to-npm.yml --ref master -f version={nextNpmVersion}`**.
   - **Or** **`git tag v{nextNpmVersion}`** && **`git push origin v{nextNpmVersion}`** only if that tag **does not** already exist on the remote; if it exists, **do not** rely on re-pushing the tag—use **`workflow_dispatch`** with **`version`**.

4. Give the user the **Actions run URL**.

---

## Rules

- Do **not** use local **`npm publish`** for this package.
- Keep messages short in Phases 1–2; Phase 3 can be terse status lines.
- If the user cancels or changes mind after Phase 2, **do not** merge or trigger CI.
