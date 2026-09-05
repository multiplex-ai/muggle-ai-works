#!/usr/bin/env node

import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const currentFilePath = fileURLToPath(import.meta.url);
const scriptsDirectoryPath = dirname(currentFilePath);
const repositoryRootPath = join(scriptsDirectoryPath, "..");
const packageJsonPath = join(repositoryRootPath, "package.json");
const runtimeTargetsPath = join(repositoryRootPath, "config", "runtime-targets.json");

/**
 * Release asset file name to the `checksumsByStream` platform key it is pinned under.
 * The pin map is keyed by platform, the release by asset name; this is the only bridge.
 */
const PLATFORM_KEY_BY_ASSET_FILE_NAME = {
    "MuggleAI-darwin-arm64.zip": "darwin-arm64",
    "MuggleAI-darwin-x64.zip": "darwin-x64",
    "MuggleAI-linux-x64.zip": "linux-x64",
    "MuggleAI-win32-x64.zip": "win32-x64",
};

const isDirectInvocation =
    Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(currentFilePath);

if (isDirectInvocation) {
    verifyElectronReleaseChecksums().catch((error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Electron release checksum verification failed: ${errorMessage}`);
        process.exit(1);
    });
}

/**
 * Verify checksums.txt exists, includes all required platform artifacts, and agrees
 * with the checksums pinned in package.json.
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

    const requiredAssetFileNames = Object.keys(PLATFORM_KEY_BY_ASSET_FILE_NAME);

    const { streams } = readJsonFile(runtimeTargetsPath);
    const checksumsByStream = packageJson?.muggleConfig?.checksumsByStream ?? {};

    for (const [releaseStream, stream] of Object.entries(streams)) {
        // A stream that records no checksums has not published a release yet.
        // Failing here would block every publish until an unrelated stream exists.
        if (Object.keys(checksumsByStream[releaseStream] ?? {}).length === 0) {
            console.log(`Skipping ${releaseStream}: no checksums recorded.`);
            continue;
        }

        const releaseTag = `${stream.electronAppReleaseTagPrefix}${bundledVersion}`;
        const checksumsUrl = `${downloadBaseUrl}/${releaseTag}/checksums.txt`;

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
                message: `checksums.txt missing valid SHA256 entry for ${requiredAssetFileName} in ${releaseTag}.`,
            });
        }

        assertPinnedChecksumsMatchPublished({
            pinnedChecksums: checksumsByStream[releaseStream],
            checksumsContent: checksumsContent,
            releaseStream: releaseStream,
            releaseTag: releaseTag,
        });

        console.log(`checksums.txt verified for ${releaseTag}.`);
    }
}

/**
 * Assert every pinned checksum equals the one the release actually published.
 *
 * Well-formedness alone cannot catch a pin left behind by an earlier electron-app
 * version: the pin map is keyed by stream and platform with no version dimension, so a
 * stale value stays syntactically valid and ships green. Comparing against the release
 * is what turns that into a build failure.
 *
 * @param {{ pinnedChecksums: Record<string, string>, checksumsContent: string, releaseStream: string, releaseTag: string }} params
 * @returns {void}
 * @throws {Error} When a pinned checksum differs from the published one, or is absent.
 */
function assertPinnedChecksumsMatchPublished({ pinnedChecksums, checksumsContent, releaseStream, releaseTag }) {
    for (const [assetFileName, platformKey] of Object.entries(PLATFORM_KEY_BY_ASSET_FILE_NAME)) {
        const pinnedChecksum = pinnedChecksums?.[platformKey];
        if (!pinnedChecksum) {
            continue;
        }

        const publishedChecksum = findPublishedChecksum({
            checksumsContent: checksumsContent,
            assetFileName: assetFileName,
        });

        assertValue({
            condition: pinnedChecksum.toLowerCase() === publishedChecksum?.toLowerCase(),
            message:
                `Pinned checksum is stale for ${releaseStream}/${platformKey} in ${releaseTag}.\n` +
                `  pinned (package.json muggleConfig.checksumsByStream.${releaseStream}.${platformKey}): ${pinnedChecksum}\n` +
                `  published (${assetFileName} in checksums.txt): ${publishedChecksum ?? "absent"}\n` +
                `Update the pin to the published value before publishing.`,
        });
    }
}

/**
 * Read the published SHA256 for one asset out of checksums.txt content.
 * @param {{ checksumsContent: string, assetFileName: string }} params
 * @returns {string | null} The checksum, or null when the asset has no valid entry.
 */
function findPublishedChecksum({ checksumsContent, assetFileName }) {
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
            return checksumValue;
        }
    }

    return null;
}

/**
 * Check whether checksums content has a valid sha256 line for an asset.
 * @param {{ checksumsContent: string, assetFileName: string }} params
 * @returns {boolean}
 */
function hasValidChecksumEntry({ checksumsContent, assetFileName }) {
    return findPublishedChecksum({
        checksumsContent: checksumsContent,
        assetFileName: assetFileName,
    }) !== null;
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

export {
    PLATFORM_KEY_BY_ASSET_FILE_NAME,
    assertPinnedChecksumsMatchPublished,
    findPublishedChecksum,
    hasValidChecksumEntry,
};
