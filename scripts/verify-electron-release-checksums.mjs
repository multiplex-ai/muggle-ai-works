#!/usr/bin/env node

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const currentFilePath = fileURLToPath(import.meta.url);
const scriptsDirectoryPath = dirname(currentFilePath);
const repositoryRootPath = join(scriptsDirectoryPath, "..");
const packageJsonPath = join(repositoryRootPath, "package.json");

verifyElectronReleaseChecksums().catch((error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Electron release checksum verification failed: ${errorMessage}`);
    process.exit(1);
});

/**
 * Verify checksums.txt exists and includes all required platform artifacts.
 * @returns {Promise<void>}
 */
async function verifyElectronReleaseChecksums() {
    const packageJson = readJsonFile(packageJsonPath);
    const bundledVersion = packageJson?.muggleConfig?.electronAppVersion;
    const downloadBaseUrl = packageJson?.muggleConfig?.downloadBaseUrl;

    assertValue({
        condition: typeof bundledVersion === "string" && bundledVersion.length > 0,
        message: "package.json muggleConfig.electronAppVersion must be defined.",
    });
    assertValue({
        condition: typeof downloadBaseUrl === "string" && downloadBaseUrl.length > 0,
        message: "package.json muggleConfig.downloadBaseUrl must be defined.",
    });

    const releaseTag = `electron-app-v${bundledVersion}`;
    const checksumsUrl = `${downloadBaseUrl}/${releaseTag}/checksums.txt`;
    const requiredAssetFileNames = [
        "MuggleAI-darwin-arm64.zip",
        "MuggleAI-darwin-x64.zip",
        "MuggleAI-linux-x64.zip",
        "MuggleAI-win32-x64.zip",
    ];

    console.log(`Verifying checksums asset: ${checksumsUrl}`);
    const response = await fetch(checksumsUrl);
    assertValue({
        condition: response.ok,
        message: `checksums.txt not available for ${releaseTag} (${response.status} ${response.statusText}).`,
    });

    const checksumsContent = await response.text();
    for (const requiredAssetFileName of requiredAssetFileNames) {
        assertValue({
            condition: hasValidChecksumEntry({
                checksumsContent: checksumsContent,
                assetFileName: requiredAssetFileName,
            }),
            message: `checksums.txt missing valid SHA256 entry for ${requiredAssetFileName}.`,
        });
    }

    console.log(`checksums.txt verified for ${releaseTag}.`);
}

/**
 * Check whether checksums content has a valid sha256 line for an asset.
 * @param {{ checksumsContent: string, assetFileName: string }} params
 * @returns {boolean}
 */
function hasValidChecksumEntry({ checksumsContent, assetFileName }) {
    const outputLines = checksumsContent.split("\n");
    const checksumPattern = /^[a-fA-F0-9]{64}$/;

    for (const outputLine of outputLines) {
        const trimmedLine = outputLine.trim();
        if (!trimmedLine) {
            continue;
        }

        const parts = trimmedLine.split(/\s+/);
        if (parts.length < 2) {
            continue;
        }

        const checksumValue = parts[0];
        const fileNameValue = parts.slice(1).join(" ").replace(/^\*?/, "");

        if (fileNameValue === assetFileName && checksumPattern.test(checksumValue)) {
            return true;
        }
    }

    return false;
}

/**
 * Read JSON file from disk.
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function readJsonFile(filePath) {
    assertValue({
        condition: existsSync(filePath),
        message: `Required file does not exist: ${filePath}`,
    });
    return JSON.parse(readFileSync(filePath, "utf-8"));
}

/**
 * Assert condition or throw.
 * @param {{ condition: boolean, message: string }} params
 * @returns {void}
 */
function assertValue({ condition, message }) {
    if (!condition) {
        throw new Error(message);
    }
}
