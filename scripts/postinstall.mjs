#!/usr/bin/env node
/**
 * Postinstall script for @muggleai/works.
 * Downloads the Electron app binary for local testing.
 * Output is written to both console and ~/.muggle-ai/postinstall.log
 */

import { createHash } from "crypto";
import { exec } from "child_process";
import {
    cpSync,
    readFileSync,
    appendFileSync,
    createReadStream,
    createWriteStream,
    existsSync,
    mkdirSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "fs";
import { homedir, platform } from "os";
import { dirname, join } from "path";
import { pipeline } from "stream/promises";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const VERSION_DIRECTORY_NAME_PATTERN = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const INSTALL_METADATA_FILE_NAME = ".install-metadata.json";
const INSTALL_MANIFEST_FILE_NAME = "install-manifest.json";
const LOG_FILE_NAME = "postinstall.log";
const VERSION_OVERRIDE_FILE_NAME = "electron-app-version-override.json";
const CURSOR_SKILLS_DIRECTORY_NAME = ".cursor";
const CURSOR_SKILLS_SUBDIRECTORY_NAME = "skills";
const MUGGLE_SKILL_PREFIX = "muggle";

/**
 * Get the path to the postinstall log file.
 * @returns {string} Path to ~/.muggle-ai/postinstall.log
 */
function getLogFilePath() {
    return join(homedir(), ".muggle-ai", LOG_FILE_NAME);
}

/**
 * Initialize the log file with a separator and timestamp.
 */
function initLogFile() {
    const logPath = getLogFilePath();
    const logDir = join(homedir(), ".muggle-ai");
    mkdirSync(logDir, { recursive: true });

    const separator = "\n" + "=".repeat(60) + "\n";
    const header = `Postinstall started at ${new Date().toISOString()}\n`;
    appendFileSync(logPath, separator + header, "utf-8");
}

/**
 * Log a message to both console and the log file.
 * @param  {...unknown} args - Arguments to log
 */
function log(...args) {
    const message = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
    console.log(...args);
    try {
        appendFileSync(getLogFilePath(), message + "\n", "utf-8");
    } catch {
        // Ignore log file write errors
    }
}

/**
 * Log an error to both console and the log file.
 * @param  {...unknown} args - Arguments to log
 */
function logError(...args) {
    const message = args
        .map((arg) => {
            if (arg instanceof Error) {
                return arg.stack || arg.message;
            }
            return typeof arg === "string" ? arg : JSON.stringify(arg);
        })
        .join(" ");
    console.error(...args);
    try {
        appendFileSync(getLogFilePath(), "[ERROR] " + message + "\n", "utf-8");
    } catch {
        // Ignore log file write errors
    }
}

/**
 * Remove the electron-app version override file if it exists.
 * Each new install should use the bundled version from package.json.
 * Users can still override manually after install, but it resets on next install.
 */
function removeVersionOverrideFile() {
    const overridePath = join(homedir(), ".muggle-ai", VERSION_OVERRIDE_FILE_NAME);

    if (existsSync(overridePath)) {
        try {
            rmSync(overridePath, { force: true });
            log(`Removed version override file: ${overridePath}`);
        } catch (error) {
            logError(`Failed to remove version override file: ${error.message}`);
        }
    }
}

/**
 * Get the Muggle AI data directory.
 * @returns {string} Path to ~/.muggle-ai
 */
function getDataDir() {
    return join(homedir(), ".muggle-ai");
}

/**
 * Get the package root directory.
 * @returns {string} Path to package root
 */
function getPackageRootDir() {
    return join(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * Get the path to the install manifest file.
 * The manifest tracks what content was installed by this package,
 * enabling cleanup of obsolete content when items are renamed or removed.
 * @returns {string} Path to ~/.muggle-ai/install-manifest.json
 */
function getInstallManifestPath() {
    return join(getDataDir(), INSTALL_MANIFEST_FILE_NAME);
}

/**
 * Read the install manifest from disk.
 * @returns {{ packageVersion?: string, skills?: string[], installedAt?: string } | null}
 */
function readInstallManifest() {
    const manifestPath = getInstallManifestPath();

    if (!existsSync(manifestPath)) {
        return null;
    }

    try {
        const content = readFileSync(manifestPath, "utf-8");
        const manifest = JSON.parse(content);

        if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
            return null;
        }

        return manifest;
    } catch {
        return null;
    }
}

/**
 * Write the install manifest to disk.
 * @param {object} params - Manifest fields
 * @param {string} params.packageVersion - The package version being installed
 * @param {string[]} params.skills - List of skill directory names installed
 */
function writeInstallManifest({ packageVersion, skills }) {
    const manifestPath = getInstallManifestPath();
    const manifest = {
        packageVersion: packageVersion,
        skills: skills,
        installedAt: new Date().toISOString(),
    };

    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

/**
 * Remove obsolete skills that were installed by a previous version but are no longer present.
 * @param {object} params - Cleanup parameters
 * @param {string[]} params.previousSkills - Skills from the previous manifest
 * @param {string[]} params.currentSkills - Skills being installed now
 * @param {string} params.cursorSkillsDirectoryPath - Path to ~/.cursor/skills
 */
function cleanupObsoleteSkills({ previousSkills, currentSkills, cursorSkillsDirectoryPath }) {
    const currentSkillSet = new Set(currentSkills);
    const obsoleteSkills = previousSkills.filter((skill) => !currentSkillSet.has(skill));

    if (obsoleteSkills.length === 0) {
        return;
    }

    for (const skillName of obsoleteSkills) {
        const skillPath = join(cursorSkillsDirectoryPath, skillName);

        if (!existsSync(skillPath)) {
            continue;
        }

        try {
            rmSync(skillPath, { recursive: true, force: true });
            log(`Removed obsolete skill: ${skillName}`);
        } catch (error) {
            logError(`Failed to remove obsolete skill ${skillName}: ${error.message}`);
        }
    }

    log(`Cleaned up ${obsoleteSkills.length} obsolete skill(s)`);
}

/**
 * Sync packaged muggle skills into Cursor user skills.
 * This enables npm installs to refresh locally available `muggle-*` skills.
 * Also cleans up obsolete skills that were removed or renamed in the package.
 */
function syncCursorSkills() {
    const packageJson = require("../package.json");
    const packageVersion = packageJson.version;

    const sourceSkillsDirectoryPath = join(getPackageRootDir(), "plugin", "skills");
    if (!existsSync(sourceSkillsDirectoryPath)) {
        log("Cursor skill sync skipped: packaged plugin skills directory not found.");
        return;
    }

    const cursorSkillsDirectoryPath = join(
        homedir(),
        CURSOR_SKILLS_DIRECTORY_NAME,
        CURSOR_SKILLS_SUBDIRECTORY_NAME,
    );
    mkdirSync(cursorSkillsDirectoryPath, { recursive: true });

    const skillEntries = readdirSync(sourceSkillsDirectoryPath, { withFileTypes: true });
    const installedSkills = [];

    for (const skillEntry of skillEntries) {
        if (!skillEntry.isDirectory()) {
            continue;
        }

        if (!skillEntry.name.startsWith(MUGGLE_SKILL_PREFIX)) {
            continue;
        }

        const sourceSkillDirectoryPath = join(sourceSkillsDirectoryPath, skillEntry.name);
        const sourceSkillFilePath = join(sourceSkillDirectoryPath, "SKILL.md");
        if (!existsSync(sourceSkillFilePath)) {
            continue;
        }

        const targetSkillDirectoryPath = join(cursorSkillsDirectoryPath, skillEntry.name);
        rmSync(targetSkillDirectoryPath, { recursive: true, force: true });
        cpSync(sourceSkillDirectoryPath, targetSkillDirectoryPath, { recursive: true });
        installedSkills.push(skillEntry.name);
    }

    log(`Synced ${installedSkills.length} muggle skill(s) to ${cursorSkillsDirectoryPath}`);

    // Clean up obsolete skills from previous installation
    const previousManifest = readInstallManifest();
    if (previousManifest && Array.isArray(previousManifest.skills)) {
        cleanupObsoleteSkills({
            previousSkills: previousManifest.skills,
            currentSkills: installedSkills,
            cursorSkillsDirectoryPath: cursorSkillsDirectoryPath,
        });
    }

    // Write updated manifest
    writeInstallManifest({
        packageVersion: packageVersion,
        skills: installedSkills,
    });
}

/**
 * Get the Electron app directory.
 * @returns {string} Path to ~/.muggle-ai/electron-app
 */
function getElectronAppDir() {
    return join(getDataDir(), "electron-app");
}

/**
 * Get platform key for checksum lookup.
 * @returns {string} Platform key (e.g., "darwin-arm64", "win32-x64")
 */
function getPlatformKey() {
    const os = platform();
    const arch = process.arch;

    switch (os) {
        case "darwin":
            return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
        case "win32":
            return "win32-x64";
        case "linux":
            return "linux-x64";
        default:
            throw new Error(`Unsupported platform: ${os}`);
    }
}

/**
 * Check whether a directory name looks like a version folder.
 * @param {string} directoryName - Directory name to validate
 * @returns {boolean} True when the directory name is a version
 */
function isVersionDirectoryName(directoryName) {
    return VERSION_DIRECTORY_NAME_PATTERN.test(directoryName);
}

/**
 * Calculate SHA256 checksum of a file.
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} SHA256 checksum as hex string
 */
async function calculateFileChecksum(filePath) {
    return new Promise((resolve, reject) => {
        const hash = createHash("sha256");
        const stream = createReadStream(filePath);

        stream.on("data", (data) => {
            hash.update(data);
        });

        stream.on("end", () => {
            resolve(hash.digest("hex"));
        });

        stream.on("error", (error) => {
            reject(error);
        });
    });
}

/**
 * Verify file checksum against expected value.
 * @param {string} filePath - Path to the file
 * @param {string} expectedChecksum - Expected SHA256 checksum
 * @returns {Promise<{valid: boolean, actual: string}>} Verification result
 */
async function verifyFileChecksum(filePath, expectedChecksum) {
    if (!expectedChecksum || expectedChecksum.trim() === "") {
        return { valid: true, actual: "", skipped: true };
    }

    const actualChecksum = await calculateFileChecksum(filePath);
    const normalizedExpected = expectedChecksum.toLowerCase().trim();
    const normalizedActual = actualChecksum.toLowerCase();

    return {
        valid: normalizedExpected === normalizedActual,
        expected: normalizedExpected,
        actual: normalizedActual,
        skipped: false,
    };
}

/**
 * Remove Electron app version directories that do not match the current version.
 * @param {object} params - Cleanup parameters
 * @param {string} params.appDir - Base Electron app directory
 * @param {string} params.currentVersion - Version that should be kept
 */
function cleanupNonCurrentVersions({ appDir, currentVersion }) {
    if (!existsSync(appDir)) {
        return;
    }

    const appEntries = readdirSync(appDir, { withFileTypes: true });

    for (const appEntry of appEntries) {
        if (!appEntry.isDirectory()) {
            continue;
        }

        if (!isVersionDirectoryName(appEntry.name)) {
            continue;
        }

        if (appEntry.name === currentVersion) {
            continue;
        }

        const staleVersionDir = join(appDir, appEntry.name);
        try {
            log(`Removing stale Electron app version: ${appEntry.name}`);
            rmSync(staleVersionDir, { recursive: true, force: true });
        } catch (error) {
            logError("\n========================================");
            logError("ERROR: Failed to remove stale Electron app version");
            logError("========================================\n");
            logError("Version:", appEntry.name);
            logError("Path:", staleVersionDir);
            logError("\nFull error details:");
            logError(error instanceof Error ? error.stack || error : error);
            logError("");
        }
    }
}

/**
 * Get platform-specific binary name.
 * @returns {string} Binary filename
 */
function getBinaryName() {
    const os = platform();
    const arch = process.arch;

    switch (os) {
        case "darwin":
            // Support both Apple Silicon (arm64) and Intel (x64) Macs
            return arch === "arm64" ? "MuggleAI-darwin-arm64.zip" : "MuggleAI-darwin-x64.zip";
        case "win32":
            return "MuggleAI-win32-x64.zip";
        case "linux":
            return "MuggleAI-linux-x64.zip";
        default:
            throw new Error(`Unsupported platform: ${os}`);
    }
}

/**
 * Get the expected extracted executable path for the current platform.
 * @param {string} versionDir - Version directory path
 * @returns {string} Expected executable path
 */
function getExpectedExecutablePath(versionDir) {
    const os = platform();

    switch (os) {
        case "darwin":
            return join(versionDir, "MuggleAI.app", "Contents", "MacOS", "MuggleAI");
        case "win32":
            return join(versionDir, "MuggleAI.exe");
        case "linux":
            return join(versionDir, "MuggleAI");
        default:
            throw new Error(`Unsupported platform: ${os}`);
    }
}

/**
 * Get the metadata file path for an installed version.
 * @param {string} versionDir - Version directory path
 * @returns {string} Metadata file path
 */
function getInstallMetadataPath(versionDir) {
    return join(versionDir, INSTALL_METADATA_FILE_NAME);
}

/**
 * Read install metadata from disk.
 * @param {string} metadataPath - Metadata file path
 * @returns {Record<string, unknown> | null} Parsed metadata, or null if missing/invalid
 */
function readInstallMetadata(metadataPath) {
    if (!existsSync(metadataPath)) {
        return null;
    }

    try {
        const metadataContent = readFileSync(metadataPath, "utf-8");
        const parsedMetadata = JSON.parse(metadataContent);
        if (typeof parsedMetadata !== "object" || parsedMetadata === null || Array.isArray(parsedMetadata)) {
            return null;
        }
        return parsedMetadata;
    } catch {
        return null;
    }
}

/**
 * Persist install metadata to disk.
 * @param {object} params - Metadata fields
 * @param {string} params.metadataPath - Metadata file path
 * @param {string} params.version - Installed version
 * @param {string} params.binaryName - Archive filename
 * @param {string} params.platformKey - Platform key
 * @param {string} params.executableChecksum - Checksum of extracted executable
 * @param {string} params.expectedArchiveChecksum - Configured archive checksum for platform
 */
function writeInstallMetadata({
    metadataPath,
    version,
    binaryName,
    platformKey,
    executableChecksum,
    expectedArchiveChecksum,
}) {
    const metadata = {
        version: version,
        binaryName: binaryName,
        platformKey: platformKey,
        executableChecksum: executableChecksum,
        expectedArchiveChecksum: expectedArchiveChecksum,
        updatedAt: new Date().toISOString(),
    };

    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
}

/**
 * Verify existing installed executable and metadata.
 * @param {object} params - Verification params
 * @param {string} params.versionDir - Installed version directory
 * @param {string} params.executablePath - Expected executable path
 * @param {string} params.version - Version string
 * @param {string} params.binaryName - Archive filename
 * @param {string} params.platformKey - Platform key
 * @param {string} params.expectedArchiveChecksum - Configured checksum for downloaded archive
 * @returns {Promise<{valid: boolean, reason: string}>} Verification result
 */
async function verifyExistingInstall({
    versionDir,
    executablePath,
    version,
    binaryName,
    platformKey,
    expectedArchiveChecksum,
}) {
    const metadataPath = getInstallMetadataPath(versionDir);
    const metadata = readInstallMetadata(metadataPath);

    if (!metadata) {
        return { valid: false, reason: "install metadata is missing or invalid" };
    }

    if (metadata.version !== version) {
        return { valid: false, reason: "installed metadata version does not match configured version" };
    }

    if (metadata.binaryName !== binaryName) {
        return { valid: false, reason: "installed metadata binary name does not match current platform archive" };
    }

    if (metadata.platformKey !== platformKey) {
        return { valid: false, reason: "installed metadata platform key does not match current platform" };
    }

    if ((metadata.expectedArchiveChecksum || "") !== expectedArchiveChecksum) {
        return { valid: false, reason: "configured archive checksum changed since previous install" };
    }

    if (typeof metadata.executableChecksum !== "string" || metadata.executableChecksum === "") {
        return { valid: false, reason: "installed metadata executable checksum is missing" };
    }

    const currentExecutableChecksum = await calculateFileChecksum(executablePath);
    if (currentExecutableChecksum !== metadata.executableChecksum) {
        return { valid: false, reason: "installed executable checksum does not match recorded checksum" };
    }

    return { valid: true, reason: "installed executable checksum is valid" };
}

/**
 * Download and extract the Electron app.
 */
async function downloadElectronApp() {
    try {
        // Read config from package.json
        const packageJson = require("../package.json");
        const config = packageJson.muggleConfig || {};
        const version = config.electronAppVersion || "1.0.0";
        const baseUrl = config.downloadBaseUrl || "https://github.com/multiplex-ai/muggle-ai-works/releases/download";

        const binaryName = getBinaryName();
        const checksums = config.checksums || {};
        const platformKey = getPlatformKey();
        const expectedChecksum = checksums[platformKey] || "";
        const downloadUrl = `${baseUrl}/electron-app-v${version}/${binaryName}`;

        const appDir = getElectronAppDir();
        const versionDir = join(appDir, version);
        const metadataPath = getInstallMetadataPath(versionDir);

        // Check if already downloaded and extracted correctly
        const expectedExecutablePath = getExpectedExecutablePath(versionDir);
        if (existsSync(versionDir)) {
            if (existsSync(expectedExecutablePath)) {
                const existingInstallVerification = await verifyExistingInstall({
                    versionDir: versionDir,
                    executablePath: expectedExecutablePath,
                    version: version,
                    binaryName: binaryName,
                    platformKey: platformKey,
                    expectedArchiveChecksum: expectedChecksum,
                });

                if (existingInstallVerification.valid) {
                    cleanupNonCurrentVersions({ appDir: appDir, currentVersion: version });
                    log(`Electron app v${version} already installed at ${versionDir}`);
                    return;
                }

                log(
                    `Installed Electron app v${version} failed verification (${existingInstallVerification.reason}). Re-downloading...`,
                );
                rmSync(versionDir, { recursive: true, force: true });
            } else {
                log(`Electron app v${version} directory exists but executable is missing. Re-downloading...`);
                rmSync(versionDir, { recursive: true, force: true });
            }
        }

        log(`Downloading Muggle Test Electron app v${version}...`);
        log(`URL: ${downloadUrl}`);

        // Create directories
        mkdirSync(versionDir, { recursive: true });

        // Download using fetch
        log("Fetching...");
        const response = await fetch(downloadUrl);
        if (!response.ok) {
            const errorBody = await response.text().catch(() => "");
            throw new Error(
                `Download failed: ${response.status} ${response.statusText}\n` +
                    `URL: ${downloadUrl}\n` +
                    `Response body: ${errorBody.substring(0, 500)}`,
            );
        }
        log(
            `Response OK (${response.status}), downloading ${response.headers.get("content-length") || "unknown"} bytes...`,
        );

        const tempFile = join(versionDir, binaryName);
        const fileStream = createWriteStream(tempFile);
        await pipeline(response.body, fileStream);

        log("Download complete, verifying checksum...");

        // Verify checksum
        const checksumResult = await verifyFileChecksum(tempFile, expectedChecksum);

        if (!checksumResult.valid && !checksumResult.skipped) {
            rmSync(versionDir, { recursive: true, force: true });
            throw new Error(
                `Checksum verification failed!\n` +
                    `Expected: ${checksumResult.expected}\n` +
                    `Actual:   ${checksumResult.actual}\n` +
                    `The downloaded file may be corrupted or tampered with.`,
            );
        }

        if (checksumResult.skipped) {
            log("Warning: No checksum configured, skipping verification.");
        } else {
            log("Checksum verified successfully.");
        }

        log("Extracting...");

        // Extract based on file type
        if (binaryName.endsWith(".zip")) {
            await extractZip(tempFile, versionDir);
        } else if (binaryName.endsWith(".tar.gz")) {
            await extractTarGz(tempFile, versionDir);
        }

        // Clean up temp file
        rmSync(tempFile, { force: true });

        if (!existsSync(expectedExecutablePath)) {
            throw new Error(
                `Extraction completed but executable was not found.\n` +
                    `Expected path: ${expectedExecutablePath}\n` +
                    `Version directory: ${versionDir}`,
            );
        }

        const executableChecksum = await calculateFileChecksum(expectedExecutablePath);
        writeInstallMetadata({
            metadataPath: metadataPath,
            version: version,
            binaryName: binaryName,
            platformKey: platformKey,
            executableChecksum: executableChecksum,
            expectedArchiveChecksum: expectedChecksum,
        });

        cleanupNonCurrentVersions({ appDir: appDir, currentVersion: version });

        log(`Electron app installed to ${versionDir}`);
    } catch (error) {
        logError("\n========================================");
        logError("ERROR: Failed to download Electron app");
        logError("========================================\n");
        logError("Error message:", error.message);
        logError("\nFull error details:");
        logError(error.stack || error);
        logError("\nDebug info:");
        logError("  - Platform:", platform());
        logError("  - Architecture:", process.arch);
        logError("  - Node version:", process.version);
        try {
            const packageJson = require("../package.json");
            const config = packageJson.muggleConfig || {};
            logError("  - Electron app version:", config.electronAppVersion || "unknown");
            logError("  - Download URL:", `${config.downloadBaseUrl}/electron-app-v${config.electronAppVersion}/${getBinaryName()}`);
        } catch {
            logError("  - Could not read package.json config");
        }
        console.error("\nYou can manually download it later using: muggle setup");
        console.error("Or set ELECTRON_APP_PATH to point to an existing installation.\n");
    }
}

/**
 * Extract a zip file.
 * @param {string} zipPath - Path to zip file
 * @param {string} destDir - Destination directory
 */
async function extractZip(zipPath, destDir) {
    return new Promise((resolve, reject) => {
        const cmd =
            platform() === "win32"
                ? `powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`
                : `unzip -o "${zipPath}" -d "${destDir}"`;

        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                logError("Extraction command failed:", cmd);
                logError("stdout:", stdout);
                logError("stderr:", stderr);
                reject(new Error(`Extraction failed: ${error.message}\nstderr: ${stderr}`));
            } else {
                resolve();
            }
        });
    });
}

/**
 * Extract a tar.gz file.
 * @param {string} tarPath - Path to tar.gz file
 * @param {string} destDir - Destination directory
 */
async function extractTarGz(tarPath, destDir) {
    return new Promise((resolve, reject) => {
        exec(`tar -xzf "${tarPath}" -C "${destDir}"`, (error) => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

/**
 * Upsert the muggle MCP server entry into ~/.cursor/mcp.json.
 * Reads the existing config, merges in the muggle server, and writes back.
 * Preserves any other MCP servers the user has configured.
 */
function upsertCursorMcpConfig() {
    const cursorMcpConfigPath = join(homedir(), ".cursor", "mcp.json");
    const cursorDir = join(homedir(), ".cursor");

    /** @type {{ mcpServers?: Record<string, unknown> }} */
    let config = {};

    if (existsSync(cursorMcpConfigPath)) {
        try {
            const raw = readFileSync(cursorMcpConfigPath, "utf-8");
            const parsed = JSON.parse(raw);

            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                log(`Warning: ~/.cursor/mcp.json has unexpected shape, skipping MCP config upsert.`);
                return;
            }

            config = parsed;
        } catch (error) {
            log(`Warning: ~/.cursor/mcp.json is invalid JSON, skipping MCP config upsert.`);
            log(`  Parse error: ${error.message}`);
            return;
        }
    }

    if (!config.mcpServers) {
        config.mcpServers = {};
    }

    config.mcpServers.muggle = {
        command: "muggle",
        args: ["serve"],
    };

    mkdirSync(cursorDir, { recursive: true });
    writeFileSync(cursorMcpConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
    log(`Cursor MCP config updated at ${cursorMcpConfigPath}`);
}

const CLAUDE_PLUGINS_DIRECTORY_NAME = ".claude";
const CLAUDE_PLUGINS_SUBDIRECTORY_NAME = "plugins";
const CLAUDE_INSTALLED_PLUGINS_FILE_NAME = "installed_plugins.json";
const CLAUDE_PLUGIN_REGISTRY_KEY = "muggleai@muggle-works";
const CLAUDE_MARKETPLACE_NAME = "muggle-works";
const CLAUDE_PLUGIN_NAME = "muggleai";

/**
 * Sync the Claude Code plugin cache after npm install.
 *
 * The Claude Code plugin system caches plugin files in
 * ~/.claude/plugins/cache/{marketplace}/{plugin}/{version}/
 * and tracks installations in ~/.claude/plugins/installed_plugins.json.
 *
 * npm install does not trigger a cache refresh, so users would need
 * to restart their session to pick up new skills/hooks. This function
 * copies the updated plugin directory into the cache and updates the
 * registry so `/reload-plugins` picks up the new version immediately.
 *
 * Only runs when the muggle plugin is already installed (won't auto-install).
 */
function syncClaudePluginCache() {
    const packageJson = require("../package.json");
    const packageVersion = packageJson.version;

    const pluginsDir = join(homedir(), CLAUDE_PLUGINS_DIRECTORY_NAME, CLAUDE_PLUGINS_SUBDIRECTORY_NAME);
    const registryPath = join(pluginsDir, CLAUDE_INSTALLED_PLUGINS_FILE_NAME);

    if (!existsSync(registryPath)) {
        log("Claude plugin sync skipped: no installed_plugins.json found.");
        return;
    }

    let registry;
    try {
        const raw = readFileSync(registryPath, "utf-8");
        registry = JSON.parse(raw);
    } catch (error) {
        log(`Claude plugin sync skipped: could not parse installed_plugins.json (${error.message})`);
        return;
    }

    if (!registry.plugins || !registry.plugins[CLAUDE_PLUGIN_REGISTRY_KEY]) {
        log("Claude plugin sync skipped: muggle plugin not installed in Claude Code.");
        return;
    }

    const entries = registry.plugins[CLAUDE_PLUGIN_REGISTRY_KEY];
    if (!Array.isArray(entries) || entries.length === 0) {
        log("Claude plugin sync skipped: no muggle plugin entries found.");
        return;
    }

    const currentEntry = entries[0];
    if (currentEntry.version === packageVersion) {
        log(`Claude plugin cache already at ${packageVersion}, no sync needed.`);
        return;
    }

    const sourcePluginDir = join(getPackageRootDir(), "plugin");
    if (!existsSync(sourcePluginDir)) {
        log("Claude plugin sync skipped: plugin directory not found in package.");
        return;
    }

    const cacheDir = join(pluginsDir, "cache", CLAUDE_MARKETPLACE_NAME, CLAUDE_PLUGIN_NAME, packageVersion);

    const previousVersion = currentEntry.version;

    try {
        if (existsSync(cacheDir)) {
            rmSync(cacheDir, { recursive: true, force: true });
        }
        cpSync(sourcePluginDir, cacheDir, { recursive: true });

        currentEntry.installPath = cacheDir;
        currentEntry.version = packageVersion;
        currentEntry.lastUpdated = new Date().toISOString();

        writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");

        log(`Claude plugin cache updated: ${previousVersion} → ${packageVersion} at ${cacheDir}`);
    } catch (error) {
        logError(`Claude plugin sync failed: ${error.message}`);
    }
}

// Run postinstall
initLogFile();
removeVersionOverrideFile();
syncCursorSkills();
syncClaudePluginCache();
upsertCursorMcpConfig();
downloadElectronApp().catch(logError);
