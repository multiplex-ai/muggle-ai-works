# Electron-App Dependency Improvements

Tracking document for improvements to the electron-app dependency management in MCP.

## Completed

### Option B: `muggle-mcp upgrade` Command
**Status:** ✅ Completed

Added `muggle-mcp upgrade` command that allows users to independently upgrade electron-app without waiting for MCP release.

**Features:**
- `muggle-mcp upgrade` - Check and install latest electron-app
- `muggle-mcp upgrade --check` - Check for updates only
- `muggle-mcp upgrade --force` - Force re-download current version
- `muggle-mcp upgrade --version 1.0.3` - Install specific version

**Implementation:**
- `src/cli/upgrade.ts` - Upgrade command implementation
- `src/shared/config.ts` - Added version override support via `~/.muggle-ai/electron-app-version-override.json`
- `src/cli/doctor.ts` - Updated to show bundled vs effective version

---

## TODO Items

### 1. Checksum Verification
**Status:** ✅ Completed

**Implementation:**
- Added `checksums` object to `muggleConfig` in `package.json` (empty by default, fill when binaries are built)
- Created `src/shared/checksum.ts` with SHA256 verification utilities
- Updated `scripts/postinstall.mjs` to verify checksum from config
- Updated `src/cli/setup.ts` to verify checksum from config
- Updated `src/cli/upgrade.ts` to fetch `checksums.txt` from GitHub release

**Checksums format in package.json:**
```json
"muggleConfig": {
  "electronAppVersion": "1.0.1",
  "downloadBaseUrl": "...",
  "checksums": {
    "darwin-arm64": "<sha256-hex>",
    "darwin-x64": "<sha256-hex>",
    "win32-x64": "<sha256-hex>",
    "linux-x64": "<sha256-hex>"
  }
}
```

**Release checksums.txt format:**
```
<sha256>  MuggleAI-darwin-arm64.zip
<sha256>  MuggleAI-darwin-x64.zip
<sha256>  MuggleAI-win32-x64.zip
<sha256>  MuggleAI-linux-x64.zip
```

**Note:** When checksums are empty/missing, verification is skipped with a warning.

---

### 2. Cleanup Old Versions
**Status:** ✅ Completed

**Implementation:**
- Created `src/cli/cleanup.ts` with cleanup and versions commands
- Registered commands in `src/cli/index.ts`
- Added auto-cleanup to `src/cli/upgrade.ts` (keeps current + 1 previous)

**Commands:**
- `muggle-mcp versions` - List installed versions with sizes
- `muggle-mcp cleanup` - Remove old versions (keeps one previous for rollback)
- `muggle-mcp cleanup --all` - Remove all old versions except current
- `muggle-mcp cleanup --dry-run` - Preview what would be deleted

**Auto-cleanup:**
After `muggle-mcp upgrade`, old versions are automatically cleaned up (keeping one previous version for rollback)

---

### 3. Force Re-download for Setup
**Priority:** Low (already implemented)  
**Status:** ✅ Already available via `muggle-mcp setup --force`

---

### 4. Environment Variable Override for Version
**Status:** ✅ Completed

**Implementation:**
- Updated `getElectronAppVersion()` in `src/shared/config.ts` to check env var first
- Added `getElectronAppVersionSource()` to identify where version came from
- Updated `src/cli/doctor.ts` to show version source

**Priority order:**
1. `ELECTRON_APP_VERSION` env var (highest - for testing/development)
2. Override file `~/.muggle-ai/electron-app-version-override.json` (set by `muggle-mcp upgrade`)
3. `package.json` `muggleConfig.electronAppVersion` (bundled default)

**Example:**
```bash
# Use a specific version for testing
ELECTRON_APP_VERSION=1.0.3 muggle-mcp serve

# Check which version is active
muggle-mcp doctor
# Shows: Electron App: Installed (v1.0.3) [from ELECTRON_APP_VERSION env]
```

---

### 5. Check Electron-App on First Tool Use
**Status:** ✅ Already Implemented

The check already exists in `spawnElectronApp()` in `src/local-qa/services/execution-service.ts`:

```typescript
const electronAppPath = config.localQa.electronAppPath;
if (!electronAppPath) {
  throw new Error(
    "Electron-app not found. Run 'muggle-mcp setup' to install, " +
    "or set ELECTRON_APP_PATH environment variable.",
  );
}
```

When a user tries to run test generation or replay without electron-app installed, they get a clear error message with instructions on how to fix it.

---

### 6. Sync Default Fallback Version
**Status:** ✅ Completed

Updated fallback version in `src/shared/config.ts` from `"1.0.0"` to `"1.0.1"` to match current bundled version. Added comment reminding to keep it in sync with `package.json`.

**Note:** The fallback is only used when `package.json` can't be read (rare edge case during development or if package is corrupted).

---

## Release Process Updates

When releasing electron-app updates:

1. **Build and test electron-app**
2. **Create GitHub release** with tag `electron-app-v{version}`
3. **Upload platform binaries** to the release
4. **(Future) Calculate checksums** and add to release notes
5. **Update MCP** (optional) - bump `electronAppVersion` in `package.json`
6. **Users can upgrade** via `muggle-mcp upgrade` without waiting for MCP release

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         MCP Package                              │
├─────────────────────────────────────────────────────────────────┤
│  package.json                                                    │
│  └── muggleConfig.electronAppVersion = "1.0.1" (bundled)        │
│                                                                  │
│  ~/.muggle-ai/                                                   │
│  ├── electron-app-version-override.json  ← muggle-mcp upgrade   │
│  │   └── { "version": "1.0.3" }                                 │
│  │                                                               │
│  └── electron-app/                                               │
│      ├── 1.0.1/  ← bundled version                              │
│      │   └── MuggleAI.exe                                       │
│      └── 1.0.3/  ← upgraded version                             │
│          └── MuggleAI.exe                                       │
│                                                                  │
│  Resolution order:                                               │
│  1. ELECTRON_APP_VERSION env var (future)                        │
│  2. electron-app-version-override.json                           │
│  3. package.json muggleConfig.electronAppVersion                 │
└─────────────────────────────────────────────────────────────────┘
```
