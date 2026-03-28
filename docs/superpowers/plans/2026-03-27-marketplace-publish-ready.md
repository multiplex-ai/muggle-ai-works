# Marketplace Publish-Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organize @muggleai/works for publishing to Claude Code marketplace, Cursor marketplace, official MCP registry, and Smithery.

**Architecture:** Single plugin directory with dual manifests (.claude-plugin + .cursor-plugin). MCP registry metadata and Smithery config at repo root. Centralized version sync script. CI validation gates for all manifests.

**Tech Stack:** Node.js scripts (ESM), GitHub Actions YAML, JSON/YAML manifests

---

### Task 1: Add Cursor Plugin Manifest

**Files:**
- Create: `plugin/.cursor-plugin/plugin.json`

- [ ] **Step 1: Create plugin/.cursor-plugin/plugin.json**

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

- [ ] **Step 2: Commit**

```bash
git add plugin/.cursor-plugin/plugin.json
git commit -m "feat: add Cursor plugin manifest"
```

---

### Task 2: Add Cursor Marketplace Index

**Files:**
- Create: `.cursor-plugin/marketplace.json`

- [ ] **Step 1: Create .cursor-plugin/marketplace.json**

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

- [ ] **Step 2: Commit**

```bash
git add .cursor-plugin/marketplace.json
git commit -m "feat: add Cursor marketplace index"
```

---

### Task 3: Add MCP Registry Metadata and Smithery Config

**Files:**
- Create: `server.json`
- Create: `smithery.yaml`
- Modify: `package.json` (add `mcpName` field)

- [ ] **Step 1: Create server.json**

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

- [ ] **Step 2: Create smithery.yaml**

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

- [ ] **Step 3: Add mcpName to package.json**

Add `"mcpName": "io.github.multiplex-ai/muggle"` to the root package.json after the `"name"` field.

- [ ] **Step 4: Commit**

```bash
git add server.json smithery.yaml package.json
git commit -m "feat: add MCP registry metadata and Smithery config"
```

---

### Task 4: Create Version Sync Script

**Files:**
- Create: `scripts/sync-versions.mjs`
- Modify: `package.json` (add `sync:versions` script, update `build` script)

- [ ] **Step 1: Create scripts/sync-versions.mjs**

```javascript
#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const currentFilePath = fileURLToPath(import.meta.url);
const scriptsDirectoryPath = dirname(currentFilePath);
const repositoryRootPath = join(scriptsDirectoryPath, "..");

const MANIFEST_PATHS = [
    {
        path: join(repositoryRootPath, ".claude-plugin", "marketplace.json"),
        update: (manifest, version) => { manifest.plugins[0].version = version; },
    },
    {
        path: join(repositoryRootPath, ".cursor-plugin", "marketplace.json"),
        update: (manifest, version) => { manifest.plugins[0].version = version; },
    },
    {
        path: join(repositoryRootPath, "plugin", ".claude-plugin", "plugin.json"),
        update: (manifest, version) => { manifest.version = version; },
    },
    {
        path: join(repositoryRootPath, "plugin", ".cursor-plugin", "plugin.json"),
        update: (manifest, version) => { manifest.version = version; },
    },
    {
        path: join(repositoryRootPath, "server.json"),
        update: (manifest, version) => {
            manifest.version = version;
            manifest.packages[0].version = version;
        },
    },
];

syncVersions();

function syncVersions() {
    const packageJsonPath = join(repositoryRootPath, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    const version = packageJson.version;

    let updatedCount = 0;

    for (const { path, update } of MANIFEST_PATHS) {
        if (!existsSync(path)) {
            console.warn(`Skipping missing manifest: ${path}`);
            continue;
        }

        const manifest = JSON.parse(readFileSync(path, "utf-8"));
        update(manifest, version);
        writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
        updatedCount++;
    }

    console.log(`Synced version ${version} across ${updatedCount} manifest(s).`);
}
```

- [ ] **Step 2: Update package.json scripts**

Add `"sync:versions": "node scripts/sync-versions.mjs"` to scripts.

Change `"build"` from `"tsup && node scripts/build-plugin.mjs"` to `"tsup && node scripts/sync-versions.mjs && node scripts/build-plugin.mjs"`.

- [ ] **Step 3: Commit**

```bash
git add scripts/sync-versions.mjs package.json
git commit -m "feat: add centralized version sync script"
```

---

### Task 5: Update Build Plugin Script

**Files:**
- Modify: `scripts/build-plugin.mjs`

- [ ] **Step 1: Update build-plugin.mjs**

The script currently copies `plugin/` to `dist/plugin/` and syncs the Claude plugin manifest version. Changes:
1. Remove the `syncPluginVersionWithPackage()` function and its call — version sync is now handled by `sync-versions.mjs` which runs before this script in the build chain.
2. The `cpSync` already recursively copies all of `plugin/` including the new `.cursor-plugin/` directory, so no additional copy logic is needed.

Updated file:

```javascript
#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const currentFilePath = fileURLToPath(import.meta.url);
const scriptsDirectoryPath = dirname(currentFilePath);
const repositoryRootPath = join(scriptsDirectoryPath, "..");
const pluginSourceDirectoryPath = join(repositoryRootPath, "plugin");
const pluginDistDirectoryPath = join(repositoryRootPath, "dist", "plugin");

buildPluginArtifact();

/**
 * Build the plugin artifact under dist/plugin from plugin source.
 * Version sync is handled by sync-versions.mjs (runs before this script).
 * @returns {void}
 */
function buildPluginArtifact() {
    if (!existsSync(pluginSourceDirectoryPath)) {
        throw new Error(`Plugin source directory does not exist: ${pluginSourceDirectoryPath}`);
    }

    rmSync(pluginDistDirectoryPath, { recursive: true, force: true });
    mkdirSync(pluginDistDirectoryPath, { recursive: true });

    cpSync(pluginSourceDirectoryPath, pluginDistDirectoryPath, { recursive: true });
    console.log("Plugin artifact built at dist/plugin/");
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/build-plugin.mjs
git commit -m "refactor: simplify build-plugin, delegate version sync"
```

---

### Task 6: Extend Verification Script

**Files:**
- Modify: `scripts/verify-plugin-marketplace.mjs`

- [ ] **Step 1: Update verify-plugin-marketplace.mjs**

Extend to validate all manifests. The updated script validates:
- Claude marketplace.json (existing checks, unchanged)
- Cursor marketplace.json (same checks, new)
- Both plugin.json manifests in plugin/ (Claude existing, Cursor new)
- Both built plugin.json manifests in dist/plugin/ (Claude existing, Cursor new)
- server.json version and packages[0].version match

```javascript
#!/usr/bin/env node

import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const currentFilePath = fileURLToPath(import.meta.url);
const scriptsDirectoryPath = dirname(currentFilePath);
const repositoryRootPath = join(scriptsDirectoryPath, "..");

const packageJsonPath = join(repositoryRootPath, "package.json");
const claudeMarketplacePath = join(repositoryRootPath, ".claude-plugin", "marketplace.json");
const cursorMarketplacePath = join(repositoryRootPath, ".cursor-plugin", "marketplace.json");
const claudePluginManifestPath = join(repositoryRootPath, "plugin", ".claude-plugin", "plugin.json");
const cursorPluginManifestPath = join(repositoryRootPath, "plugin", ".cursor-plugin", "plugin.json");
const builtClaudePluginManifestPath = join(repositoryRootPath, "dist", "plugin", ".claude-plugin", "plugin.json");
const builtCursorPluginManifestPath = join(repositoryRootPath, "dist", "plugin", ".cursor-plugin", "plugin.json");
const serverJsonPath = join(repositoryRootPath, "server.json");

verifyPluginMarketplace();

function verifyPluginMarketplace() {
    const packageJson = readJsonFile(packageJsonPath);
    const version = packageJson.version;

    // Claude marketplace
    const claudeMarketplace = readJsonFile(claudeMarketplacePath);
    verifyMarketplace({ marketplace: claudeMarketplace, version, label: "Claude" });

    // Cursor marketplace
    const cursorMarketplace = readJsonFile(cursorMarketplacePath);
    verifyMarketplace({ marketplace: cursorMarketplace, version, label: "Cursor" });

    // Plugin manifests (source)
    const claudePlugin = readJsonFile(claudePluginManifestPath);
    verifyPluginManifest({ manifest: claudePlugin, version, label: "Claude" });

    const cursorPlugin = readJsonFile(cursorPluginManifestPath);
    verifyPluginManifest({ manifest: cursorPlugin, version, label: "Cursor" });

    // Plugin manifests (built)
    const builtClaudePlugin = readJsonFile(builtClaudePluginManifestPath);
    verifyPluginManifest({ manifest: builtClaudePlugin, version, label: "Built Claude" });

    const builtCursorPlugin = readJsonFile(builtCursorPluginManifestPath);
    verifyPluginManifest({ manifest: builtCursorPlugin, version, label: "Built Cursor" });

    // MCP registry metadata
    const serverJson = readJsonFile(serverJsonPath);
    assertValue({
        condition: serverJson.version === version,
        message: `server.json version (${serverJson.version}) must match package.json version (${version}).`,
    });
    assertValue({
        condition: Array.isArray(serverJson.packages) && serverJson.packages.length > 0,
        message: "server.json must have at least one package entry.",
    });
    assertValue({
        condition: serverJson.packages[0].version === version,
        message: `server.json packages[0].version (${serverJson.packages[0].version}) must match package.json version (${version}).`,
    });

    console.log("Plugin marketplace verification passed.");
}

function verifyMarketplace({ marketplace, version, label }) {
    assertValue({
        condition: marketplace.name === "muggle-works",
        message: `${label} marketplace name must be muggle-works.`,
    });

    assertValue({
        condition: Array.isArray(marketplace.plugins) && marketplace.plugins.length === 1,
        message: `${label} marketplace must declare exactly one plugin entry.`,
    });

    const [plugin] = marketplace.plugins;

    assertValue({
        condition: plugin.name === "muggleai",
        message: `${label} marketplace plugin entry name must be muggleai.`,
    });

    assertValue({
        condition: plugin.version === version,
        message: `${label} marketplace plugin version (${plugin.version}) must match package.json version (${version}).`,
    });

    assertValue({
        condition: typeof plugin.source === "string" && plugin.source.length > 0,
        message: `${label} marketplace plugin source must be a non-empty string.`,
    });

    const sourcePath = resolve(repositoryRootPath, plugin.source);
    assertValue({
        condition: existsSync(sourcePath),
        message: `${label} marketplace plugin source path does not exist: ${sourcePath}`,
    });
}

function verifyPluginManifest({ manifest, version, label }) {
    assertValue({
        condition: manifest.name === "muggle",
        message: `${label} plugin manifest name must be muggle.`,
    });

    assertValue({
        condition: manifest.version === version,
        message: `${label} plugin manifest version (${manifest.version}) must match package.json version (${version}).`,
    });
}

function readJsonFile(pathToFile) {
    const fileContent = readFileSync(pathToFile, "utf-8");
    return JSON.parse(fileContent);
}

function assertValue({ condition, message }) {
    if (!condition) {
        throw new Error(message);
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/verify-plugin-marketplace.mjs
git commit -m "feat: extend verification to cover Cursor and MCP registry manifests"
```

---

### Task 7: Remove Dead Code from Postinstall

**Files:**
- Modify: `scripts/postinstall.mjs`

- [ ] **Step 1: Remove dead skill/command copying code**

The postinstall already skips skill installation and Cursor MCP config (lines 860-861 log skip messages). Remove the dead code:

1. Remove constants: `SKILLS_DIR_NAME`, `SKILLS_TARGET_DIR`, `COMMANDS_TARGET_DIR`, `SKILLS_CHECKSUMS_FILE`, `COMMAND_FILES`
2. Remove functions: `getCursorMcpConfigPath()`, `buildCursorServerConfig()`, `readCursorConfig()`, `updateCursorMcpConfig()`, `readSkillsChecksums()`, `writeSkillsChecksums()`, `promptUserChoice()`, `backupSkillFile()`, `installSkills()`
3. Remove unused import: `exec` from `child_process`
4. Remove constant: `CURSOR_SERVER_NAME`
5. Keep: all Electron app download functions, logging infrastructure, version override removal

- [ ] **Step 2: Verify the postinstall still works**

```bash
cd /Users/stan/Github/muggle-ai-works && node scripts/postinstall.mjs
```

Expected: logs "Skipping..." messages and attempts Electron app download.

- [ ] **Step 3: Commit**

```bash
git add scripts/postinstall.mjs
git commit -m "refactor: remove dead skill-copying and Cursor MCP code from postinstall"
```

---

### Task 8: Add CI Manifest Verification Job

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add verify-manifests job to ci.yml**

Add after the existing `platform-compat` job:

```yaml

  # Verify all plugin manifests are consistent
  verify-manifests:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: "22"

      - name: Setup pnpm
        uses: pnpm/action-setup@v5

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm run build

      - name: Verify plugin manifests
        run: pnpm run verify:plugin
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add manifest verification job"
```

---

### Task 9: Extend Publish Workflow

**Files:**
- Modify: `.github/workflows/publish-works.yml`

- [ ] **Step 1: Add Cursor manifest to tarball validation**

In the `package-audit` job's "Validate package contents" step, add to the `required` array:
```javascript
"package/plugin/.cursor-plugin/plugin.json"
```

- [ ] **Step 2: Add MCP registry publish job**

Add after the `publish` job:

```yaml
  publish-mcp-registry:
    runs-on: ubuntu-latest
    needs:
      - publish
    if: startsWith(github.ref, 'refs/tags/') || github.event_name == 'workflow_dispatch'
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: "22"

      - name: Install mcp-publisher
        run: npm install -g mcp-publisher

      - name: Publish to MCP registry
        env:
          MCP_REGISTRY_TOKEN: ${{ secrets.MCP_REGISTRY_TOKEN }}
        run: mcp-publisher publish
```

- [ ] **Step 3: Add publish-mcp-registry to notify-on-failure needs**

Update the `notify-on-failure` job's `needs` array to include `publish-mcp-registry`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/publish-works.yml
git commit -m "ci: add MCP registry publish and Cursor manifest validation"
```

---

### Task 10: Build and Verify

- [ ] **Step 1: Run full build**

```bash
cd /Users/stan/Github/muggle-ai-works && pnpm run build
```

Expected: succeeds, dist/plugin/ contains both .claude-plugin/ and .cursor-plugin/

- [ ] **Step 2: Run verification**

```bash
pnpm run verify:plugin
```

Expected: "Plugin marketplace verification passed."

- [ ] **Step 3: Run tests**

```bash
pnpm test
```

Expected: all tests pass

- [ ] **Step 4: Run lint**

```bash
pnpm run lint:check
```

Expected: no errors
