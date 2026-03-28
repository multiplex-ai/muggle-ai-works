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

/**
 * Sync version from package.json into all manifest files.
 * @returns {void}
 */
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
