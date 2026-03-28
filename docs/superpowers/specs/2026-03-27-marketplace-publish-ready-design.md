# Marketplace Publish-Ready Reorganization

**Date:** 2026-03-27
**Status:** Approved
**Scope:** Organize `@muggleai/works` for publishing to Claude Code marketplace, Cursor marketplace, and MCP registries

## Goals

1. Publish the plugin to both Claude Code and Cursor marketplaces
2. List the MCP server on the official MCP registry (modelcontextprotocol.io) and Smithery
3. Ensure all manifests, versions, and metadata are consistent and validated in CI
4. Simplify postinstall by removing skill-copying (plugin system is now canonical)
5. Full validation pipeline: no release goes out with inconsistent manifests

## Approach

**Single Plugin Dir + Dual Manifests.** The `plugin/` directory contains both `.claude-plugin/plugin.json` and `.cursor-plugin/plugin.json` side by side. Skills, hooks, MCP config, and scripts are shared. MCP registry metadata (`server.json`) and Smithery config (`smithery.yaml`) live at repo root since they describe the npm package, not the plugin.

This follows the proven pattern used by the `superpowers` plugin which ships manifests for multiple platforms from a single directory.

## Design

### 1. Plugin Directory Structure

```
plugin/
├── .claude-plugin/
│   └── plugin.json              # Claude plugin manifest (exists, no change)
├── .cursor-plugin/
│   └── plugin.json              # NEW: Cursor plugin manifest
├── .mcp.json                    # MCP server config (shared, no change)
├── README.md                    # Plugin documentation (no change)
├── hooks/
│   └── hooks.json               # Session-start hook (no change)
├── skills/                      # All skills (no change)
│   ├── do/
│   ├── test-feature-local/
│   ├── status/
│   ├── repair/
│   └── upgrade/
└── scripts/
    └── ensure-electron-app.sh   # Hook dependency (no change)
```

The new `plugin/.cursor-plugin/plugin.json`:

```json
{
  "name": "muggle",
  "displayName": "Muggle AI",
  "description": "Ship quality products with AI-powered QA that validates your app's user experience — from Claude Code and Cursor to PR.",
  "version": "3.0.0",
  "author": {
    "name": "Muggle AI",
    "email": "support@muggle-ai.com"
  },
  "homepage": "https://www.muggletest.com",
  "repository": "https://github.com/multiplex-ai/muggle-ai-works",
  "license": "MIT",
  "keywords": ["qa", "testing", "mcp", "browser-automation", "ai-coding", "muggle-ai"]
}
```

### 2. Root-Level Marketplace & Registry Files

```
repo root:
├── .claude-plugin/
│   └── marketplace.json         # Claude marketplace index (exists, no change)
├── .cursor-plugin/
│   └── marketplace.json         # NEW: Cursor marketplace index
├── server.json                  # NEW: MCP registry metadata
├── smithery.yaml                # NEW: Smithery registry listing
```

**Cursor marketplace.json** (`.cursor-plugin/marketplace.json`):

```json
{
  "name": "muggle-works",
  "owner": {
    "name": "Muggle AI",
    "email": "support@muggle-ai.com"
  },
  "plugins": [
    {
      "name": "muggleai",
      "source": "./plugin",
      "description": "Ship quality products with AI-powered QA that validates your app's user experience — from Claude Code and Cursor to PR.",
      "version": "3.0.0"
    }
  ]
}
```

**MCP registry metadata** (`server.json`):

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.multiplex-ai/muggle",
  "description": "AI-powered QA that validates your app's user experience",
  "repository": {
    "url": "https://github.com/multiplex-ai/muggle-ai-works",
    "source": "github"
  },
  "version": "3.0.0",
  "packages": [
    {
      "registryType": "npm",
      "identifier": "@muggleai/works",
      "version": "3.0.0",
      "runtime": "node",
      "runtimeArgs": [">=22.0.0"],
      "transport": { "type": "stdio" },
      "environmentVariables": []
    }
  ]
}
```

**Smithery config** (`smithery.yaml`):

```yaml
startCommand:
  type: stdio
configSchema:
  type: object
  properties: {}
commandFunction: |-
  (config) => ({
    command: 'npx',
    args: ['-y', '@muggleai/works', 'serve']
  })
```

**package.json addition:** Add `"mcpName": "io.github.multiplex-ai/muggle"` for MCP registry validation.

### 3. Build System Changes

**`scripts/sync-versions.mjs` (NEW)**

Single source of truth: `package.json` version. Updates all manifest files in-place:

| File | Field(s) updated |
|------|-----------------|
| `.claude-plugin/marketplace.json` | `plugins[0].version` |
| `.cursor-plugin/marketplace.json` | `plugins[0].version` |
| `plugin/.claude-plugin/plugin.json` | `version` |
| `plugin/.cursor-plugin/plugin.json` | `version` |
| `server.json` | `version`, `packages[0].version` |

**`scripts/build-plugin.mjs` (MODIFIED)**

- Copy `plugin/.cursor-plugin/` to `dist/plugin/.cursor-plugin/` (in addition to existing `.claude-plugin/` copy)
- Remove inline version-sync logic (now handled by `sync-versions.mjs`)

**`scripts/verify-plugin-marketplace.mjs` (MODIFIED)**

Extend validation to cover all manifests:

- `.cursor-plugin/marketplace.json`: name is `muggle-works`, one plugin named `muggleai`, version matches
- `plugin/.cursor-plugin/plugin.json`: name is `muggle`, version matches
- `dist/plugin/.cursor-plugin/plugin.json`: version matches (after build)
- `server.json`: exists, version matches, `packages[0].version` matches
- All versions equal to `package.json` version

**`package.json` script changes:**

```json
{
  "sync:versions": "node scripts/sync-versions.mjs",
  "build": "tsup && node scripts/sync-versions.mjs && node scripts/build-plugin.mjs"
}
```

### 4. Postinstall Simplification

Remove skill/command copying from `scripts/postinstall.mjs`. This removes:

- Constants: `SKILLS_DIR_NAME`, `SKILLS_TARGET_DIR`, `COMMANDS_TARGET_DIR`, `SKILLS_CHECKSUMS_FILE`, `COMMAND_FILES`
- All functions related to: skill file copying, checksum diffing, user-modification detection, backup prompts, command file installation
- The `installSkills()` / `installCommands()` call chain in the main function

Keep:
- Electron app binary download (core functionality)
- Cursor MCP config setup (`~/.cursor/mcp.json`) — still needed for non-plugin-marketplace users
- Logging infrastructure
- Version override file handling

Expected reduction: ~400 lines removed.

### 5. CI/CD Pipeline Changes

**`ci.yml` — add `verify-manifests` job:**

```yaml
verify-manifests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v6
    - uses: actions/setup-node@v6
      with:
        node-version: "22"
    - uses: pnpm/action-setup@v5
    - run: pnpm install --frozen-lockfile
    - run: pnpm run build
    - run: pnpm run verify:plugin
```

Runs on every PR and push to master. Catches version drift before release.

**`publish-works.yml` — add MCP registry publish:**

New job after `publish`:

```yaml
publish-mcp-registry:
  needs: [publish]
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v6
    - name: Install mcp-publisher
      run: npm install -g mcp-publisher
    - name: Publish to MCP registry
      env:
        MCP_REGISTRY_TOKEN: ${{ secrets.MCP_REGISTRY_TOKEN }}
      run: mcp-publisher publish
```

**`publish-works.yml` — extend `package-audit` validation:**

Add to the tarball content validation:
- `package/plugin/.cursor-plugin/plugin.json` must exist
- `server.json` must NOT be in the tarball (repo-level metadata, not npm-distributed)

### 6. One-Time Manual Steps

After implementation is complete:

1. **Claude directory:** Submit plugin at `clau.de/plugin-directory-submission` (repo URL)
2. **Cursor marketplace:** Submit plugin at `cursor.com/marketplace/publish` (repo URL, requires open-source)
3. **MCP registry auth:** Run `mcp-publisher login github`, store token as `MCP_REGISTRY_TOKEN` GitHub Actions secret
4. **Smithery listing:** Run `smithery mcp publish <repo-url>` once; updates auto-pulled from repo
5. **Verify:** Run `claude plugin install muggleai` and test in Cursor after marketplace approval

## File Change Summary

**New files (5):**

| File | Purpose |
|------|---------|
| `plugin/.cursor-plugin/plugin.json` | Cursor plugin manifest |
| `.cursor-plugin/marketplace.json` | Cursor marketplace index |
| `server.json` | Official MCP registry metadata |
| `smithery.yaml` | Smithery registry listing |
| `scripts/sync-versions.mjs` | Version sync across all manifests |

**Modified files (6):**

| File | Change |
|------|--------|
| `package.json` | Add `mcpName` field, update `build` script, add `sync:versions` script |
| `scripts/build-plugin.mjs` | Copy `.cursor-plugin/` to dist, remove inline version sync |
| `scripts/verify-plugin-marketplace.mjs` | Validate Cursor manifests + `server.json` + cross-manifest version consistency |
| `scripts/postinstall.mjs` | Remove skill/command copying (~400 lines) |
| `.github/workflows/ci.yml` | Add `verify-manifests` job |
| `.github/workflows/publish-works.yml` | Add MCP registry publish job, extend tarball validation |

**Unchanged:** All source code (`src/`, `packages/`), all existing skills, tsup/turbo/tsconfig, eslint, vitest, existing Claude plugin manifest, existing Claude marketplace manifest.
