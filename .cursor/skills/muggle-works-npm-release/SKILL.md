---
name: muggle-works-npm-release
description: >-
  Internal workflow to ship @muggleai/works: align Electron bundle and checksums
  in repo, merge to main, then publish to npm via GitHub Actions
  (.github/workflows/publish-works-to-npm.yml)—not local npm publish.
---

# Muggle AI Works — npm release (internal)

## When to use

- Shipping a new **`@muggleai/works`** version after product or packaging changes.
- Pointing the package at the **latest** published Electron desktop build (`electron-app-v*` on GitHub).

## Source of truth

| What | Where |
| :--- | :---- |
| npm package version | Root `package.json` → `version` |
| Bundled desktop build | Root `package.json` → `muggleConfig.electronAppVersion` |
| Download URL base | `muggleConfig.downloadBaseUrl` (usually `https://github.com/multiplex-ai/muggle-ai-works/releases/download`) |
| Per-platform SHA256 | `muggleConfig.checksums` keys: `darwin-arm64`, `darwin-x64`, `win32-x64`, `linux-x64` |
| Release artifacts | GitHub repo `multiplex-ai/muggle-ai-works`, tags `electron-app-vX.Y.Z` |

The teaching-service `packages/electron-app/package.json` **version** field is not the same as `electronAppVersion`; the latter must match an existing **`electron-app-v*`** GitHub release with `checksums.txt` and the four `MuggleAI-*.zip` assets.

## Publish to npm (required path)

**Do not rely on `npm publish` from a laptop** for this package. Publishing is automated by:

**[`.github/workflows/publish-works-to-npm.yml`](.github/workflows/publish-works-to-npm.yml)** — workflow name: **Publish Works to npm**.

### What the workflow does

- **verify**: `pnpm install --frozen-lockfile`, lint, tests, `pnpm run build`, `pnpm run verify:electron-release-checksums`.
- **package-audit**: Aligns `package.json` version (see triggers below), sets **`muggleConfig.runtimeTargetDefault` to `production`**, removes `scripts.prepare`, `npm pack`, validates tarball contents, uploads artifact.
- **smoke-install**: Installs the tarball globally on Ubuntu, Windows, and macOS runners; runs `muggle --version` and `muggle doctor`.
- **publish**: Publishes the packed tarball with **`npm publish … --access public --provenance`**, using **`NODE_AUTH_TOKEN`** from secrets. Job uses GitHub Environment **`npm-publish`** (configure protection rules and **`NPM_TOKEN`** there as needed).

### How to trigger a publish

1. **Tag push (typical after merge)**  
   - Land `package.json` + synced manifests on the default branch with the intended **semver** (e.g. `4.2.4`).  
   - Create and push an **annotated or lightweight tag** matching that version: **`v` + semver**, e.g. `v4.2.4`.  
   - The workflow runs on **`push` tags matching `v*`**. The **package-audit** job sets the published version from the tag (without the leading `v`) if it differs from `package.json`.

2. **workflow_dispatch (manual)**  
   In GitHub: **Actions** → **Publish Works to npm** → **Run workflow**.  
   - **version**: Exact semver to publish (e.g. `4.2.5`). Leave **empty** to run `npm version <bump>` on the checked-out ref (`patch` / `minor` / `major`).  
   - Note: a manual run publishes from the **selected branch/ref**; ensure that ref already has the desired `electronAppVersion` and checksums.

### Agent / operator checklist

- After code changes are on **`master`**, either **push `vX.Y.Z`** or run **workflow_dispatch** with the target version.  
- Do not tell users to publish with local **`npm publish`** unless debugging outside CI; production releases go through this workflow.

## Repo preparation steps (before triggering CI)

1. **Resolve latest Electron release**  
   List releases: `https://api.github.com/repos/multiplex-ai/muggle-ai-works/releases?per_page=20` — newest tag **`electron-app-v*`** (e.g. `electron-app-v1.0.32` → `1.0.32`).

2. **Fetch checksums**  
   `{downloadBaseUrl}/electron-app-v{version}/checksums.txt` — map to `muggleConfig.checksums`:
   - `MuggleAI-darwin-arm64.zip` → `darwin-arm64`
   - `MuggleAI-darwin-x64.zip` → `darwin-x64`
   - `MuggleAI-win32-x64.zip` → `win32-x64`
   - `MuggleAI-linux-x64.zip` → `linux-x64`

3. **Edit root `package.json`**  
   - Set **`version`** to the semver you will publish (and tag as `v…` if using tag trigger).  
   - Set **`muggleConfig.electronAppVersion`**.  
   - Fill all four **`muggleConfig.checksums`** entries.

4. **Build and sync manifests**  
   `pnpm run build` or `npm run build` (same pipeline: `tsup`, `sync-versions.mjs`, `build-plugin.mjs`).

5. **Verify Electron release**  
   `pnpm run verify:electron-release-checksums` or `npm run verify:electron-release-checksums`.

6. **Quality gates (optional locally)**  
   `pnpm run typecheck`, `pnpm test`, `pnpm run lint:check`, `pnpm run verify:upgrade-experience`, etc. (CI runs lint, test, build, and checksum verify.)

7. **Git**  
   PR + merge to default branch, then **push tag `vX.Y.Z`** or **workflow_dispatch** as above.

## Quick checksums fetch (manual)

```bash
curl -sL "https://github.com/multiplex-ai/muggle-ai-works/releases/download/electron-app-vVERSION/checksums.txt"
```

Replace `VERSION` with the semver (the path uses `electron-app-v` + version, no extra `v` inside the number).
