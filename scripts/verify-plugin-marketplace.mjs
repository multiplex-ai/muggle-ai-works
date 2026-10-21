#!/usr/bin/env node

import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { renderCodexHooks } from "./build-codex-hooks.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const scriptsDirectoryPath = dirname(currentFilePath);
const repositoryRootPath = join(scriptsDirectoryPath, "..");

const packageJsonPath = join(repositoryRootPath, "package.json");
const claudeMarketplacePath = join(repositoryRootPath, ".claude-plugin", "marketplace.json");
const cursorMarketplacePath = join(repositoryRootPath, ".cursor-plugin", "marketplace.json");
const codexMarketplacePath = join(repositoryRootPath, ".agents", "plugins", "marketplace.json");
const claudePluginManifestPath = join(repositoryRootPath, "plugin", ".claude-plugin", "plugin.json");
const cursorPluginManifestPath = join(repositoryRootPath, "plugin", ".cursor-plugin", "plugin.json");
const codexPluginManifestPath = join(repositoryRootPath, "plugin", ".codex-plugin", "plugin.json");
const pluginRootPath = join(repositoryRootPath, "plugin");
const claudeMcpConfigPath = join(pluginRootPath, ".mcp.json");
const codexHooksPath = join(pluginRootPath, "hooks", "codex-hooks.json");
const builtClaudePluginManifestPath = join(repositoryRootPath, "dist", "plugin", ".claude-plugin", "plugin.json");
const builtCursorPluginManifestPath = join(repositoryRootPath, "dist", "plugin", ".cursor-plugin", "plugin.json");
const builtCodexPluginManifestPath = join(repositoryRootPath, "dist", "plugin", ".codex-plugin", "plugin.json");

// Claude Code and Cursor install the marketplace's `muggleai` entry; Codex
// requires the entry name to equal plugin.json's, and the shared `muggle`
// namespace is what skills and hooks name (`/muggle:…`, `$muggle:…`).
const CLAUDE_MARKETPLACE_PLUGIN_NAME = "muggleai";
const CODEX_MARKETPLACE_PLUGIN_NAME = "muggle";

// The longest local run the skills ask for (plugin/skills/_shared/dev-loop/timeouts.md:
// timeoutMs 900000). Codex cancels an MCP call at its tool timeout — 60s unless set —
// so the Codex server must outlast that run.
const LONGEST_DOCUMENTED_LOCAL_RUN_SECONDS = 900;
const serverJsonPath = join(repositoryRootPath, "server.json");

verifyPluginMarketplace();

/**
 * Verify plugin metadata and marketplace catalog consistency across all platforms.
 * @returns {void}
 */
function verifyPluginMarketplace() {
    const packageJson = readJsonFile(packageJsonPath);
    const version = packageJson.version;

    // Claude marketplace
    const claudeMarketplace = readJsonFile(claudeMarketplacePath);
    verifyMarketplace({ marketplace: claudeMarketplace, version, label: "Claude", pluginName: CLAUDE_MARKETPLACE_PLUGIN_NAME });

    // Cursor marketplace
    const cursorMarketplace = readJsonFile(cursorMarketplacePath);
    verifyMarketplace({ marketplace: cursorMarketplace, version, label: "Cursor", pluginName: CLAUDE_MARKETPLACE_PLUGIN_NAME });

    // Codex marketplace
    const codexMarketplace = readJsonFile(codexMarketplacePath);
    verifyMarketplace({ marketplace: codexMarketplace, version, label: "Codex", pluginName: CODEX_MARKETPLACE_PLUGIN_NAME });

    // Plugin manifests (source)
    const claudePlugin = readJsonFile(claudePluginManifestPath);
    verifyPluginManifest({ manifest: claudePlugin, version, label: "Claude" });

    const cursorPlugin = readJsonFile(cursorPluginManifestPath);
    verifyPluginManifest({ manifest: cursorPlugin, version, label: "Cursor" });

    const codexPlugin = readJsonFile(codexPluginManifestPath);
    verifyPluginManifest({ manifest: codexPlugin, version, label: "Codex" });
    verifyCodexPluginManifest({ manifest: codexPlugin });

    // Plugin manifests (built)
    const builtClaudePlugin = readJsonFile(builtClaudePluginManifestPath);
    verifyPluginManifest({ manifest: builtClaudePlugin, version, label: "Built Claude" });

    const builtCursorPlugin = readJsonFile(builtCursorPluginManifestPath);
    verifyPluginManifest({ manifest: builtCursorPlugin, version, label: "Built Cursor" });

    const builtCodexPlugin = readJsonFile(builtCodexPluginManifestPath);
    verifyPluginManifest({ manifest: builtCodexPlugin, version, label: "Built Codex" });

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

/**
 * Verify a marketplace.json file.
 * @param {{ marketplace: Record<string, unknown>, version: string, label: string, pluginName: string }} params
 * @returns {void}
 */
function verifyMarketplace({ marketplace, version, label, pluginName }) {
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
        condition: plugin.name === pluginName,
        message: `${label} marketplace plugin entry name must be ${pluginName}.`,
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

/**
 * Verify a plugin.json manifest file.
 * @param {{ manifest: Record<string, unknown>, version: string, label: string }} params
 * @returns {void}
 */
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

/**
 * Verify what only Codex reads from its plugin manifest: the component paths,
 * the Codex MCP server config, and the generated Codex hooks manifest.
 * @param {{ manifest: Record<string, unknown> }} params
 * @returns {void}
 */
function verifyCodexPluginManifest({ manifest }) {
    for (const field of ["skills", "mcpServers", "hooks"]) {
        const declaredPath = manifest[field];
        assertValue({
            condition: typeof declaredPath === "string" && declaredPath.startsWith("./"),
            message: `Codex plugin manifest ${field} must be a "./"-relative path; Codex ignores any other form.`,
        });
        assertValue({
            condition: existsSync(join(pluginRootPath, declaredPath)),
            message: `Codex plugin manifest ${field} path does not exist: ${declaredPath}`,
        });
    }

    const codexServer = readJsonFile(join(pluginRootPath, manifest.mcpServers)).mcpServers?.muggle;
    const claudeServer = readJsonFile(claudeMcpConfigPath).mcpServers?.muggle;
    assertValue({
        condition: Boolean(codexServer),
        message: "Codex MCP config must declare the muggle server.",
    });
    assertValue({
        condition:
            codexServer.command === claudeServer.command &&
            JSON.stringify(codexServer.args) === JSON.stringify(claudeServer.args),
        message: "Codex MCP config must launch the muggle server exactly as plugin/.mcp.json does.",
    });
    assertValue({
        condition: codexServer.env?.MUGGLE_MCP_HOST === "codex",
        message: "Codex MCP config must stamp MUGGLE_MCP_HOST=codex; Codex passes MCP servers no host signal of its own.",
    });
    assertValue({
        condition: Number(codexServer.tool_timeout_sec) > LONGEST_DOCUMENTED_LOCAL_RUN_SECONDS,
        message: `Codex MCP tool_timeout_sec must exceed ${LONGEST_DOCUMENTED_LOCAL_RUN_SECONDS}s, the longest local run the skills request.`,
    });

    assertValue({
        condition: readFileSync(codexHooksPath, "utf-8") === renderCodexHooks(),
        message: "plugin/hooks/codex-hooks.json is out of date with plugin/hooks/hooks.json. Run `pnpm run build:codex-hooks`.",
    });
}

/**
 * Read a JSON file from disk.
 * @param {string} pathToFile
 * @returns {Record<string, unknown>}
 */
function readJsonFile(pathToFile) {
    const fileContent = readFileSync(pathToFile, "utf-8");
    return JSON.parse(fileContent);
}

/**
 * Assert a verification condition.
 * @param {{ condition: boolean, message: string }} params
 * @returns {void}
 */
function assertValue({ condition, message }) {
    if (!condition) {
        throw new Error(message);
    }
}
