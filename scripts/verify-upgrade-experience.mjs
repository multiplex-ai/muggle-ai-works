#!/usr/bin/env node

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

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

verifyUpgradeExperience();

/**
 * Validate existing-user upgrade behavior:
 * 1) setup download
 * 2) cleanup old artifact
 * 3) forced upgrade redownload
 * 4) post-upgrade health checks
 * @returns {void}
 */
function verifyUpgradeExperience() {
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

        const upgradeResult = runMuggleCommand({
            args: ["upgrade", "--force"],
            environmentVariables: isolatedEnvironmentVariables,
        });
        const upgradeCombinedOutput = upgradeResult.combinedOutput;
        assertValue({
            condition: !upgradeCombinedOutput.includes("Checksums file not found"),
            message: "upgrade --force reported missing checksums.txt; checksum verification coverage is incomplete.",
        });
        assertValue({
            condition: !upgradeCombinedOutput.includes("Checksum verification skipped"),
            message: "upgrade --force skipped checksum verification; release artifacts must provide checksums.",
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
