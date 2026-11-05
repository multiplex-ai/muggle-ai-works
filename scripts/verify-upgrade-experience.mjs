#!/usr/bin/env node

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { SIGNATURE_BUNDLE_SUFFIX, compareVersions } from "./release-integrity/index.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const scriptsDirectoryPath = dirname(currentFilePath);
const repositoryRootPath = join(scriptsDirectoryPath, "..");

const muggleCliPath = join(repositoryRootPath, "bin", "muggle.js");
const ANSI_ESCAPE_CHARACTER = String.fromCharCode(27);
const ANSI_ESCAPE_PATTERN = new RegExp(`${ANSI_ESCAPE_CHARACTER}\\[[0-9;]*m`, "g");
const ALLOWED_DOCTOR_FAILURE_CHECK_NAMES = new Set([
    "Authentication",
    "API Key",
    "Credentials File",
    "Cursor MCP Config",
]);
const GITHUB_RELEASES_API_URL = "https://api.github.com/repos/multiplex-ai/muggle-ai-works/releases?per_page=100";
const NEXT_PAGE_LINK_PATTERN = /<([^>]+)>;\s*rel="next"/;
const DOWNLOAD_URL_LINE_PATTERN = /^URL: \S+\/releases\/download\/([^/\s]+)\/(\S+)$/m;
const RELEASE_TAG_PATTERN = /^(.+-v)(\d+\.\d+\.\d+)$/;
const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const CHECKSUMS_ASSET_NAME = "checksums.txt";
const UPLOADED_ASSET_STATE = "uploaded";
const VERSION_OVERRIDE_FILE_NAME = "electron-app-version-override.json";

await verifyUpgradeExperience();

/**
 * Validate existing-user upgrade behavior:
 * 1) setup download
 * 2) cleanup old artifact
 * 3) forced upgrade installs the newest release this platform can install
 * 4) post-upgrade health checks
 * @returns {Promise<void>}
 */
async function verifyUpgradeExperience() {
    assertValue({
        condition: existsSync(muggleCliPath),
        message: `CLI entrypoint not found: ${muggleCliPath}`,
    });

    const isolatedHomeDirectoryPath = mkdtempSync(join(tmpdir(), "muggle-upgrade-smoke-"));
    const isolatedEnvironmentVariables = createIsolatedEnvironmentVariables({
        isolatedHomeDirectoryPath: isolatedHomeDirectoryPath,
    });

    try {
        console.log(`Using isolated HOME for upgrade smoke: ${isolatedHomeDirectoryPath}`);

        const setupResult = runMuggleCommand({
            args: ["setup", "--force"],
            environmentVariables: isolatedEnvironmentVariables,
        });
        assertValue({
            condition: setupResult.success,
            message: "setup --force failed; existing-user upgrade flow is broken.",
        });
        const pinnedDownload = parseStudioDownload({ commandOutput: setupResult.combinedOutput });

        const dataDirectoryPath = join(isolatedHomeDirectoryPath, ".muggle-ai");
        const electronAppRootDirectoryPath = join(dataDirectoryPath, "electron-app");
        const initialVersionDirectoryPath = resolveInstalledVersionDirectoryPath({
            electronAppRootDirectoryPath: electronAppRootDirectoryPath,
        });
        const initialInstallMetadataPath = join(initialVersionDirectoryPath, ".install-metadata.json");

        assertValue({
            condition: existsSync(initialInstallMetadataPath),
            message: `Install metadata missing after setup/upgrade bootstrap: ${initialInstallMetadataPath}`,
        });

        const syntheticOldVersionDirectoryPath = join(electronAppRootDirectoryPath, "0.0.1");
        mkdirSync(syntheticOldVersionDirectoryPath, { recursive: true });
        writeFileSync(join(syntheticOldVersionDirectoryPath, "obsolete-marker.txt"), "obsolete\n", "utf-8");

        runMuggleCommand({
            args: ["cleanup", "--all"],
            environmentVariables: isolatedEnvironmentVariables,
        });

        assertValue({
            condition: !existsSync(syntheticOldVersionDirectoryPath),
            message: "cleanup --all did not remove synthetic old version directory.",
        });

        const installableReleaseRequirements = {
            releaseTagPrefix: pinnedDownload.releaseTagPrefix,
            platformArchiveName: pinnedDownload.platformArchiveName,
            signedFromVersion: readSignedFromVersion(),
        };
        const newestVersionBeforeUpgrade = await fetchNewestInstallableVersion(installableReleaseRequirements);

        const upgradeResult = runMuggleCommand({
            args: ["upgrade", "--force"],
            environmentVariables: isolatedEnvironmentVariables,
        });
        const upgradeCombinedOutput = upgradeResult.combinedOutput;
        assertValue({
            condition: upgradeResult.success,
            message: "upgrade --force failed.",
        });
        assertValue({
            condition: !upgradeCombinedOutput.includes("Checksums file not found"),
            message: "upgrade --force reported missing checksums.txt; checksum verification coverage is incomplete.",
        });
        assertValue({
            condition: !upgradeCombinedOutput.includes("Checksum verification skipped"),
            message: "upgrade --force skipped checksum verification; release artifacts must provide checksums.",
        });

        const newestVersionAfterUpgrade = await fetchNewestInstallableVersion(installableReleaseRequirements);
        assertUpgradeInstalledNewestRelease({
            upgradeOutput: upgradeCombinedOutput,
            dataDirectoryPath: dataDirectoryPath,
            releaseTagPrefix: pinnedDownload.releaseTagPrefix,
            acceptedVersions: new Set([newestVersionBeforeUpgrade, newestVersionAfterUpgrade]),
        });

        const versionDirectoryPaths = listVersionDirectoryPaths({
            electronAppRootDirectoryPath: electronAppRootDirectoryPath,
        });
        assertValue({
            condition: versionDirectoryPaths.length > 0,
            message: "No electron-app version directories found after upgrade --force.",
        });

        const newestVersionDirectoryPath = getNewestDirectoryPath({
            directoryPaths: versionDirectoryPaths,
        });
        const newestInstallMetadataPath = join(newestVersionDirectoryPath, ".install-metadata.json");

        assertValue({
            condition: existsSync(newestInstallMetadataPath),
            message: `Install metadata missing in upgraded directory: ${newestInstallMetadataPath}`,
        });

        const doctorResult = runMuggleCommand({
            args: ["doctor"],
            environmentVariables: isolatedEnvironmentVariables,
        });
        assertValue({
            condition: doctorResult.success,
            message: "doctor command failed to run.",
        });

        const nonAllowlistedDoctorFailures = parseDoctorFailureCheckNames({
            doctorOutput: doctorResult.combinedOutput,
        }).filter((checkName) => !ALLOWED_DOCTOR_FAILURE_CHECK_NAMES.has(checkName));
        assertValue({
            condition: nonAllowlistedDoctorFailures.length === 0,
            message: `doctor reported non-allowlisted failures: ${nonAllowlistedDoctorFailures.join(", ")}`,
        });
        runMuggleCommand({
            args: ["status"],
            environmentVariables: isolatedEnvironmentVariables,
        });

        console.log("Upgrade experience verification passed.");
    } finally {
        rmSync(isolatedHomeDirectoryPath, { recursive: true, force: true });
    }
}

/**
 * Require the forced upgrade to have installed the newest release this platform can install.
 * The newest version is read before and after the upgrade, so a release published while it
 * ran is accepted too.
 * @param {{ upgradeOutput: string, dataDirectoryPath: string, releaseTagPrefix: string, acceptedVersions: Set<string | null> }} params
 * @returns {void}
 */
function assertUpgradeInstalledNewestRelease({ upgradeOutput, dataDirectoryPath, releaseTagPrefix, acceptedVersions }) {
    const upgradeDownload = parseStudioDownload({ commandOutput: upgradeOutput });
    const versionOverride = JSON.parse(readFileSync(join(dataDirectoryPath, VERSION_OVERRIDE_FILE_NAME), "utf-8"));
    const acceptedVersionList = [...acceptedVersions].join(" or ");

    console.log(`upgrade --force installed v${versionOverride.version}; newest installable release: v${acceptedVersionList}`);
    assertValue({
        condition: upgradeDownload.releaseTagPrefix === releaseTagPrefix,
        message: `upgrade --force left its lane: downloaded from ${upgradeDownload.releaseTagPrefix}, setup used ${releaseTagPrefix}.`,
    });
    assertValue({
        condition: upgradeDownload.version === versionOverride.version,
        message: `upgrade --force downloaded v${upgradeDownload.version} but recorded v${versionOverride.version}.`,
    });
    assertValue({
        condition: acceptedVersions.has(versionOverride.version),
        message: `upgrade --force installed v${versionOverride.version}, not the newest installable release v${acceptedVersionList}.`,
    });
}

/**
 * Read the release a setup or upgrade run downloaded from its `URL:` line.
 * @param {{ commandOutput: string }} params
 * @returns {{ releaseTagPrefix: string, version: string, platformArchiveName: string }}
 */
function parseStudioDownload({ commandOutput }) {
    const downloadUrlMatch = commandOutput.match(DOWNLOAD_URL_LINE_PATTERN);
    assertValue({
        condition: Boolean(downloadUrlMatch),
        message: "Command output names no Studio download URL.",
    });
    const releaseTagMatch = downloadUrlMatch[1].match(RELEASE_TAG_PATTERN);
    assertValue({
        condition: Boolean(releaseTagMatch),
        message: `Studio download URL carries an unexpected release tag: ${downloadUrlMatch[1]}`,
    });

    return {
        releaseTagPrefix: releaseTagMatch[1],
        version: releaseTagMatch[2],
        platformArchiveName: downloadUrlMatch[2],
    };
}

/**
 * Read the first Studio version published with a signature bundle.
 * @returns {string}
 */
function readSignedFromVersion() {
    const packageManifest = JSON.parse(readFileSync(join(repositoryRootPath, "package.json"), "utf-8"));
    return packageManifest.muggleConfig.electronAppSignedFromVersion;
}

/**
 * Find the newest version on a lane that a platform can install, from every page of the
 * live release list. Written apart from the CLI's own pick so the check never grades
 * that code with itself.
 * @param {{ releaseTagPrefix: string, platformArchiveName: string, signedFromVersion: string }} params
 * @returns {Promise<string | null>}
 */
async function fetchNewestInstallableVersion({ releaseTagPrefix, platformArchiveName, signedFromVersion }) {
    let newestVersion = null;
    let pageUrl = GITHUB_RELEASES_API_URL;

    while (pageUrl) {
        const response = await fetch(pageUrl, { headers: buildGitHubApiHeaders() });
        assertValue({
            condition: response.ok,
            message: `Reading the release list failed: ${response.status} ${response.statusText}`,
        });

        for (const release of await response.json()) {
            const version = release.tag_name.startsWith(releaseTagPrefix)
                ? release.tag_name.slice(releaseTagPrefix.length)
                : "";
            if (release.draft || !RELEASE_VERSION_PATTERN.test(version)) {
                continue;
            }

            const requiredAssetNames = [platformArchiveName, CHECKSUMS_ASSET_NAME];
            if (compareVersions(version, signedFromVersion) >= 0) {
                requiredAssetNames.push(platformArchiveName + SIGNATURE_BUNDLE_SUFFIX);
            }
            const uploadedAssetNames = new Set(
                release.assets.filter((asset) => asset.state === UPLOADED_ASSET_STATE).map((asset) => asset.name),
            );
            const isInstallable = requiredAssetNames.every((assetName) => uploadedAssetNames.has(assetName));
            if (isInstallable && (!newestVersion || compareVersions(version, newestVersion) > 0)) {
                newestVersion = version;
            }
        }

        pageUrl = response.headers.get("link")?.match(NEXT_PAGE_LINK_PATTERN)?.[1] ?? null;
    }

    return newestVersion;
}

/**
 * Headers for this check's own release list reads. A token, when CI provides one, keeps
 * them off the anonymous rate limit the CLI under test already draws on.
 * @returns {Record<string, string>}
 */
function buildGitHubApiHeaders() {
    const gitHubToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    return {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "muggle-upgrade-verification",
        ...(gitHubToken ? { "Authorization": `Bearer ${gitHubToken}` } : {}),
    };
}

/**
 * Execute the CLI with isolated environment variables.
 * @param {{ args: string[], environmentVariables: NodeJS.ProcessEnv }} params
 * @returns {void}
 */
function runMuggleCommand({ args, environmentVariables }) {
    const commandArguments = [muggleCliPath, ...args];
    console.log(`Running command: node ${commandArguments.join(" ")}`);
    const commandResult = spawnSync(process.execPath, commandArguments, {
        cwd: repositoryRootPath,
        env: environmentVariables,
        encoding: "utf-8",
    });

    const standardOutputText = commandResult.stdout ?? "";
    const standardErrorText = commandResult.stderr ?? "";
    const combinedOutput = `${standardOutputText}${standardErrorText}`;
    process.stdout.write(standardOutputText);
    process.stderr.write(standardErrorText);

    return {
        success: commandResult.status === 0,
        statusCode: commandResult.status ?? -1,
        combinedOutput: combinedOutput,
    };
}

/**
 * Parse failed doctor check names from doctor command output.
 * @param {{ doctorOutput: string }} params
 * @returns {string[]}
 */
function parseDoctorFailureCheckNames({ doctorOutput }) {
    const failureCheckNames = [];
    const cleanedOutput = doctorOutput.replaceAll(ANSI_ESCAPE_PATTERN, "");
    const outputLines = cleanedOutput.split("\n");

    for (const outputLine of outputLines) {
        const trimmedLine = outputLine.trim();
        const failedCheckMatch = trimmedLine.match(/^✗\s+([^:]+):/);
        if (failedCheckMatch) {
            failureCheckNames.push(failedCheckMatch[1]);
        }
    }

    return failureCheckNames;
}

/**
 * Create isolated HOME/HOMEPATH environment for smoke runs.
 * @param {{ isolatedHomeDirectoryPath: string }} params
 * @returns {NodeJS.ProcessEnv}
 */
function createIsolatedEnvironmentVariables({ isolatedHomeDirectoryPath }) {
    return {
        ...process.env,
        HOME: isolatedHomeDirectoryPath,
        USERPROFILE: isolatedHomeDirectoryPath,
    };
}

/**
 * List version-like subdirectories under electron-app root.
 * @param {{ electronAppRootDirectoryPath: string }} params
 * @returns {string[]}
 */
function listVersionDirectoryPaths({ electronAppRootDirectoryPath }) {
    assertValue({
        condition: existsSync(electronAppRootDirectoryPath),
        message: `Electron app root directory not found: ${electronAppRootDirectoryPath}`,
    });

    const entries = readdirSync(electronAppRootDirectoryPath, { withFileTypes: true });
    const versionDirectoryNamePattern = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;

    return entries
        .filter((entry) => entry.isDirectory())
        .filter((entry) => versionDirectoryNamePattern.test(entry.name))
        .map((entry) => join(electronAppRootDirectoryPath, entry.name));
}

/**
 * Resolve an installed version directory from electron-app root.
 * @param {{ electronAppRootDirectoryPath: string }} params
 * @returns {string}
 */
function resolveInstalledVersionDirectoryPath({ electronAppRootDirectoryPath }) {
    const versionDirectoryPaths = listVersionDirectoryPaths({
        electronAppRootDirectoryPath: electronAppRootDirectoryPath,
    });

    assertValue({
        condition: versionDirectoryPaths.length > 0,
        message: `No installed version directories found in: ${electronAppRootDirectoryPath}`,
    });

    return getNewestDirectoryPath({
        directoryPaths: versionDirectoryPaths,
    });
}

/**
 * Get newest directory by mtime.
 * @param {{ directoryPaths: string[] }} params
 * @returns {string}
 */
function getNewestDirectoryPath({ directoryPaths }) {
    assertValue({
        condition: directoryPaths.length > 0,
        message: "Cannot choose newest directory from an empty list.",
    });

    const sortedDirectoryPaths = [...directoryPaths].sort((leftDirectoryPath, rightDirectoryPath) => {
        const leftMtimeMilliseconds = statSync(leftDirectoryPath).mtimeMs;
        const rightMtimeMilliseconds = statSync(rightDirectoryPath).mtimeMs;
        return rightMtimeMilliseconds - leftMtimeMilliseconds;
    });

    return sortedDirectoryPaths[0];
}

/**
 * Assert condition.
 * @param {{ condition: boolean, message: string }} params
 * @returns {void}
 */
function assertValue({ condition, message }) {
    if (!condition) {
        throw new Error(message);
    }
}
