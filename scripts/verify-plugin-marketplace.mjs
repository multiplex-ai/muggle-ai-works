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

/**
 * Verify plugin metadata and marketplace catalog consistency across all platforms.
 * @returns {void}
 */
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

/**
 * Verify a marketplace.json file.
 * @param {{ marketplace: Record<string, unknown>, version: string, label: string }} params
 * @returns {void}
 */
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
