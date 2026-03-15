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
**Priority:** Medium  
**Risk:** Disk space accumulates over time

**Implementation:**
1. Add `muggle-mcp cleanup` command
2. Automatically cleanup during `upgrade` (keep only current + previous version)
3. List installed versions with `muggle-mcp versions`

**Commands:**
- `muggle-mcp cleanup` - Remove old electron-app versions
- `muggle-mcp cleanup --all` - Remove all versions except current
- `muggle-mcp versions` - List installed versions

**Files to create/modify:**
- `src/cli/cleanup.ts` - New cleanup command
- `src/cli/index.ts` - Register command
- `src/cli/upgrade.ts` - Auto-cleanup after upgrade

---

### 3. Force Re-download for Setup
**Priority:** Low (already implemented)  
**Status:** ✅ Already available via `muggle-mcp setup --force`

---

### 4. Environment Variable Override for Version
**Priority:** Medium  
**Risk:** Power users can't easily test different versions

**Implementation:**
1. Check `ELECTRON_APP_VERSION` env var in `getElectronAppVersion()`
2. Priority: ENV VAR > Override File > package.json

**Files to modify:**
- `src/shared/config.ts` - Add env var check

**Example:**
```bash
ELECTRON_APP_VERSION=1.0.3 muggle-mcp serve
```

---

### 5. Check Electron-App on First Tool Use
**Priority:** Medium  
**Risk:** User may not have electron-app when they try to use local testing tools

**Implementation:**
1. In `executeTestGeneration` and `executeReplay`, check if electron-app exists
2. If not, prompt user to run `muggle-mcp setup` or auto-download
3. Consider adding `--auto-setup` flag to `serve` command

**Files to modify:**
- `src/local-qa/services/execution-service.ts` - Add check
- Possibly `src/cli/serve.ts` - Add auto-setup option

---

### 6. Sync Default Fallback Version
**Priority:** Low  
**Risk:** Hardcoded fallback `"1.0.0"` may diverge from actual latest

**Implementation:**
Option A: Remove fallback (fail if package.json not readable)
Option B: Keep fallback but ensure it's updated with each release (CI check)

**Current location:** `src/shared/config.ts` line ~93

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
