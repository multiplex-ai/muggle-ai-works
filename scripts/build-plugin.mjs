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
