#!/usr/bin/env node

import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const currentFilePath = fileURLToPath(import.meta.url);
const scriptsDirectoryPath = dirname(currentFilePath);
const repositoryRootPath = join(scriptsDirectoryPath, "..");

const packageJsonPath = join(repositoryRootPath, "package.json");
const marketplaceJsonPath = join(repositoryRootPath, ".claude-plugin", "marketplace.json");
const pluginManifestPath = join(repositoryRootPath, "plugin", ".claude-plugin", "plugin.json");
const builtPluginManifestPath = join(repositoryRootPath, "dist", "plugin", ".claude-plugin", "plugin.json");

verifyPluginMarketplace();

/**
 * Verify plugin metadata and marketplace catalog consistency.
 * @returns {void}
 */
function verifyPluginMarketplace() {
    const packageJson = readJsonFile(packageJsonPath);
    const marketplaceJson = readJsonFile(marketplaceJsonPath);
    const pluginManifest = readJsonFile(pluginManifestPath);
    const builtPluginManifest = readJsonFile(builtPluginManifestPath);

    assertValue({
        condition: marketplaceJson.name === "muggle-plugins",
        message: "Marketplace name must be muggle-plugins.",
    });

    assertValue({
        condition: Array.isArray(marketplaceJson.plugins) && marketplaceJson.plugins.length === 1,
        message: "Marketplace must declare exactly one plugin entry.",
    });

    const [marketplacePlugin] = marketplaceJson.plugins;

    assertValue({
        condition: marketplacePlugin.name === pluginManifest.name,
        message: "Marketplace plugin name must match plugin manifest name.",
    });

    assertValue({
        condition: marketplacePlugin.version === packageJson.version,
        message: "Marketplace plugin version must match package.json version.",
    });

    assertValue({
        condition: pluginManifest.version === packageJson.version,
        message: "Plugin manifest version must match package.json version.",
    });

    assertValue({
        condition: builtPluginManifest.version === packageJson.version,
        message: "Built plugin manifest version must match package.json version.",
    });

    assertValue({
        condition: typeof marketplacePlugin.source === "string" && marketplacePlugin.source.length > 0,
        message: "Marketplace plugin source must be a non-empty string.",
    });

    const marketplacePluginSourcePath = resolve(repositoryRootPath, marketplacePlugin.source);

    assertValue({
        condition: existsSync(marketplacePluginSourcePath),
        message: `Marketplace plugin source path does not exist: ${marketplacePluginSourcePath}`,
    });

    console.log("Plugin marketplace verification passed.");
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
