#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const currentFilePath = fileURLToPath(import.meta.url);
const scriptsDirectoryPath = dirname(currentFilePath);
const repositoryRootPath = join(scriptsDirectoryPath, "..");
const pluginSourceDirectoryPath = join(repositoryRootPath, "plugin");
const pluginDistDirectoryPath = join(repositoryRootPath, "dist", "plugin");
const packageJsonPath = join(repositoryRootPath, "package.json");
const pluginManifestPath = join(pluginDistDirectoryPath, ".claude-plugin", "plugin.json");

buildPluginArtifact();

/**
 * Build the plugin artifact under dist/plugin from plugin source.
 * @returns {void}
 */
function buildPluginArtifact() {
    if (!existsSync(pluginSourceDirectoryPath)) {
        throw new Error(`Plugin source directory does not exist: ${pluginSourceDirectoryPath}`);
    }

    rmSync(pluginDistDirectoryPath, { recursive: true, force: true });
    mkdirSync(pluginDistDirectoryPath, { recursive: true });

    cpSync(pluginSourceDirectoryPath, pluginDistDirectoryPath, { recursive: true });
    syncPluginVersionWithPackage();
}

/**
 * Keep plugin manifest version aligned with package.json version.
 * @returns {void}
 */
function syncPluginVersionWithPackage() {
    const packageJsonContent = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent);

    const pluginManifestContent = readFileSync(pluginManifestPath, "utf-8");
    const pluginManifest = JSON.parse(pluginManifestContent);

    pluginManifest.version = packageJson.version;
    writeFileSync(pluginManifestPath, `${JSON.stringify(pluginManifest, null, 2)}\n`, "utf-8");
}
