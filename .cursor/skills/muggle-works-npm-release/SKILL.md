---
name: muggle-works-npm-release
description: >-
  Internal workflow to ship a new @muggleai/works npm version: align bundled
  Electron app (GitHub release), refresh checksums, bump package version, build,
  verify, and publish. Use when releasing muggle-ai-works or refreshing
  electronAppVersion.
---

# Muggle AI Works — npm release (internal)

## When to use

- Publishing `@muggleai/works` to npm after product or packaging changes.
- Pointing the npm package at the **latest** published Electron desktop build (`electron-app-v*` on GitHub).

## Source of truth

| What | Where |
| :--- | :---- |
| npm package version | Root `package.json` → `version` |
| Bundled desktop build | Root `package.json` → `muggleConfig.electronAppVersion` |
| Download URL base | `muggleConfig.downloadBaseUrl` (usually `https://github.com/multiplex-ai/muggle-ai-works/releases/download`) |
| Per-platform SHA256 | `muggleConfig.checksums` keys: `darwin-arm64`, `darwin-x64`, `win32-x64`, `linux-x64` |
| Release artifacts | GitHub repo `multiplex-ai/muggle-ai-works`, tags `electron-app-vX.Y.Z` |

The teaching-service `packages/electron-app/package.json` **version** field is not the same as `electronAppVersion`; the latter must match an existing **`electron-app-v*`** GitHub release with `checksums.txt` and the four `MuggleAI-*.zip` assets.

## Steps

1. **Resolve latest Electron release**  
   List tags (example): `https://api.github.com/repos/multiplex-ai/muggle-ai-works/releases?per_page=20` and take the newest `electron-app-v*` (e.g. `electron-app-v1.0.32` → version `1.0.32`).

2. **Fetch checksums**  
   Download `checksums.txt` from  
   `{downloadBaseUrl}/electron-app-v{version}/checksums.txt`  
   Map lines to `muggleConfig.checksums`:
   - `MuggleAI-darwin-arm64.zip` → `darwin-arm64`
   - `MuggleAI-darwin-x64.zip` → `darwin-x64`
   - `MuggleAI-win32-x64.zip` → `win32-x64`
   - `MuggleAI-linux-x64.zip` → `linux-x64`

3. **Edit root `package.json`**  
   - Bump `version` (semver for the npm package).  
   - Set `muggleConfig.electronAppVersion` to the chosen `X.Y.Z`.  
   - Fill all four `muggleConfig.checksums` entries (do not leave empty strings if you want install-time verification).

4. **Build and sync manifests**  
   From repo root: `npm run build`  
   (runs `tsup`, `scripts/sync-versions.mjs`, and `scripts/build-plugin.mjs` so plugin/marketplace versions match `package.json`.)

5. **Verify Electron release**  
   `npm run verify:electron-release-checksums`  
   Confirms `checksums.txt` exists for `electron-app-v{muggleConfig.electronAppVersion}` and lists all required zips.

6. **Quality gates (as needed)**  
   `npm run typecheck`, `npm test`, `npm run lint:check`, `npm run verify:upgrade-experience`, etc.

7. **Publish to npm**  
   - Ensure `npm whoami` succeeds and the account has **publish** rights to the `@muggleai` scope.  
   - `npm publish --access public`  
   If `PUT` returns **404**, the logged-in user typically lacks permission to publish under `@muggleai/works`; fix org/token access, then retry.

8. **Git**  
   Commit the updated `package.json`, synced manifests (`.claude-plugin/`, `.cursor-plugin/`, `plugin/`, `server.json`), and any regenerated `dist/` if your process requires it. Tag or open PR per team practice.

## Quick checksums fetch (manual)

```bash
curl -sL "https://github.com/multiplex-ai/muggle-ai-works/releases/download/electron-app-vVERSION/checksums.txt"
```

Replace `VERSION` with the semver (no `v` prefix in the path segment after `electron-app-v`).
