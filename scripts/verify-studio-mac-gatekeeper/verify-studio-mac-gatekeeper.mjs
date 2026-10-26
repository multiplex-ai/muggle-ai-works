#!/usr/bin/env node
/* global AbortSignal */

import { execFile } from "child_process";
import { createHash } from "crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import { promisify } from "util";

import { PLATFORM_KEY_BY_ASSET_FILE_NAME } from "../verify-electron-release-checksums.mjs";
import {
    ARCHIVE_DOWNLOAD_TIMEOUT_MS,
    MAC_APP_BUNDLE_NAME,
    MAC_PLATFORM_KEYS,
    QUARANTINE_AGENT_NAME,
    QUARANTINE_ATTRIBUTE_NAME,
    QUARANTINE_FLAGS,
} from "./constants.mjs";

const execFileAsync = promisify(execFile);

const currentFilePath = fileURLToPath(import.meta.url);
const repositoryRootPath = join(dirname(currentFilePath), "..", "..");
const packageJsonPath = join(repositoryRootPath, "package.json");
const runtimeTargetsPath = join(repositoryRootPath, "config", "runtime-targets.json");

const isDirectInvocation =
    Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(currentFilePath);

if (isDirectInvocation) {
    verifyStudioMacGatekeeper().catch((error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Studio macOS Gatekeeper verification failed:\n${errorMessage}`);
        process.exit(1);
    });
}

/**
 * Install every pinned macOS studio archive the way @muggleai/works does, quarantine it
 * like a browser download, and require codesign and Gatekeeper to accept it.
 *
 * Signing and notarization can pass on the built app while the archive users download
 * is broken, so only the archive itself is evidence.
 * @returns {Promise<void>}
 * @throws {Error} When not running on macOS, or when any pinned archive fails a check.
 */
async function verifyStudioMacGatekeeper() {
    assertValue({
        condition: process.platform === "darwin",
        message: "This check needs macOS: codesign and spctl exist only there.",
    });

    const packageJson = readJsonFile(packageJsonPath);
    const { streams } = readJsonFile(runtimeTargetsPath);
    const pinnedMacArchives = listPinnedMacArchives({
        muggleConfig: packageJson.muggleConfig ?? {},
        streams: streams,
    });

    assertValue({
        condition: pinnedMacArchives.length > 0,
        message: "package.json muggleConfig pins no macOS studio archive.",
    });

    const failedArchiveReports = [];
    for (const pinnedMacArchive of pinnedMacArchives) {
        const archiveLabel = `${pinnedMacArchive.releaseStream}/${pinnedMacArchive.platformKey}`;
        const workDirectoryPath = mkdtempSync(join(tmpdir(), "studio-mac-gatekeeper-"));
        console.log(`\nVerifying ${archiveLabel}: ${pinnedMacArchive.downloadUrl}`);

        try {
            const passReport = await verifyMacArchive({
                pinnedMacArchive: pinnedMacArchive,
                workDirectoryPath: workDirectoryPath,
            });
            console.log(`PASS ${archiveLabel}: ${passReport}`);
        } catch (error) {
            const failureReason = error instanceof Error ? error.message : String(error);
            console.log(`FAIL ${archiveLabel}: ${failureReason}`);
            failedArchiveReports.push(`${archiveLabel}: ${failureReason}`);
        } finally {
            rmSync(workDirectoryPath, { recursive: true, force: true });
        }
    }

    assertValue({
        condition: failedArchiveReports.length === 0,
        message: failedArchiveReports.join("\n"),
    });
    console.log(`\nAll ${pinnedMacArchives.length} pinned macOS studio archives pass Gatekeeper.`);
}

/**
 * List the macOS archives package.json pins, with the URL postinstall downloads each from.
 *
 * Output shape:
 * `[{ releaseStream: "production", platformKey: "darwin-arm64", assetFileName: "MuggleAI-darwin-arm64.zip",
 *    downloadUrl: "https://…/electron-app-v1.16.0/MuggleAI-darwin-arm64.zip", pinnedChecksum: "5e8a…" }]`
 * @param {{ muggleConfig: Record<string, any>, streams: Record<string, { electronAppReleaseTagPrefix: string }> }} params
 * @returns {Array<{ releaseStream: string, platformKey: string, assetFileName: string, downloadUrl: string, pinnedChecksum: string }>}
 * @throws {Error} When the pin is incomplete for a stream that records checksums.
 */
function listPinnedMacArchives({ muggleConfig, streams }) {
    const electronAppVersion = muggleConfig.electronAppVersion;
    const downloadBaseUrl = muggleConfig.downloadBaseUrl;
    assertValue({
        condition: typeof electronAppVersion === "string" && electronAppVersion.length > 0,
        message: "package.json muggleConfig.electronAppVersion must be defined.",
    });
    assertValue({
        condition: typeof downloadBaseUrl === "string" && downloadBaseUrl.length > 0,
        message: "package.json muggleConfig.downloadBaseUrl must be defined.",
    });

    const pinnedMacArchives = [];
    for (const [releaseStream, stream] of Object.entries(streams)) {
        const pinnedChecksums = muggleConfig.checksumsByStream?.[releaseStream] ?? {};
        // A stream that records no checksums has not published a release yet, so
        // postinstall installs nothing from it.
        if (Object.keys(pinnedChecksums).length === 0) {
            console.log(`Skipping ${releaseStream}: no checksums recorded.`);
            continue;
        }

        for (const platformKey of MAC_PLATFORM_KEYS) {
            const pinnedChecksum = pinnedChecksums[platformKey];
            assertValue({
                condition: typeof pinnedChecksum === "string" && pinnedChecksum.length > 0,
                message: `package.json muggleConfig.checksumsByStream.${releaseStream}.${platformKey} must be defined.`,
            });

            const assetFileName = findAssetFileName({ platformKey: platformKey });
            pinnedMacArchives.push({
                releaseStream: releaseStream,
                platformKey: platformKey,
                assetFileName: assetFileName,
                downloadUrl: `${downloadBaseUrl}/${stream.electronAppReleaseTagPrefix}${electronAppVersion}/${assetFileName}`,
                pinnedChecksum: pinnedChecksum,
            });
        }
    }

    return pinnedMacArchives;
}

/**
 * Download, checksum, extract, quarantine, and assess one macOS studio archive.
 * @param {{ pinnedMacArchive: { assetFileName: string, downloadUrl: string, pinnedChecksum: string }, workDirectoryPath: string }} params
 * @returns {Promise<string>} One line summarizing the evidence the archive passed on.
 * @throws {Error} Naming the first check the archive failed.
 */
async function verifyMacArchive({ pinnedMacArchive, workDirectoryPath }) {
    const archivePath = join(workDirectoryPath, pinnedMacArchive.assetFileName);
    await downloadFile({ url: pinnedMacArchive.downloadUrl, destinationPath: archivePath });

    const downloadedChecksum = await calculateSha256({ filePath: archivePath });
    assertValue({
        condition: downloadedChecksum.toLowerCase() === pinnedMacArchive.pinnedChecksum.toLowerCase(),
        message:
            `downloaded archive does not match its pin (pinned ${pinnedMacArchive.pinnedChecksum}, ` +
            `downloaded ${downloadedChecksum}).`,
    });

    // The same extractor postinstall, `muggle setup` and `muggle upgrade` run.
    const extractDirectoryPath = join(workDirectoryPath, "extracted");
    mkdirSync(extractDirectoryPath);
    await execFileAsync("unzip", ["-q", "-o", archivePath, "-d", extractDirectoryPath]);

    const appBundlePath = join(extractDirectoryPath, MAC_APP_BUNDLE_NAME);
    assertValue({
        condition: existsSync(appBundlePath),
        message: `archive does not extract to ${MAC_APP_BUNDLE_NAME}.`,
    });

    // Gatekeeper only assesses quarantined files. A Node download leaves none, which is
    // why a broken bundle can launch fine on one machine and be "damaged" on the next.
    await execFileAsync("xattr", ["-r", "-w", QUARANTINE_ATTRIBUTE_NAME, buildQuarantineValue(), appBundlePath]);

    const symbolicLinkCount = countSymbolicLinks({ directoryPath: appBundlePath });
    assertValue({
        condition: symbolicLinkCount > 0,
        message:
            `${MAC_APP_BUNDLE_NAME} contains no symlinks. The archive was packed without preserving them ` +
            "(zip without -y), so every framework's Versions/Current link shipped as a copy, the code seal no " +
            'longer matches, and Gatekeeper reports the app as "damaged".',
    });

    const codesignResult = await runAssessment({
        command: "codesign",
        commandArguments: ["--verify", "--deep", "--strict", "--verbose=2", appBundlePath],
    });
    assertValue({
        condition: codesignResult.isPassed,
        message: `codesign rejected the extracted bundle:\n${codesignResult.output}`,
    });

    const gatekeeperResult = await runAssessment({
        command: "spctl",
        commandArguments: ["-a", "-vvv", "-t", "exec", appBundlePath],
    });
    assertValue({
        condition: gatekeeperResult.isPassed,
        message: `Gatekeeper (spctl) rejected the quarantined bundle:\n${gatekeeperResult.output}`,
    });

    const gatekeeperSource = gatekeeperResult.output.match(/^source=(.+)$/m)?.[1] ?? "accepted";
    return `${symbolicLinkCount} symlinks, codesign valid, spctl accepted (${gatekeeperSource})`;
}

/**
 * Find the release asset name `checksumsByStream` pins under a platform key.
 * @param {{ platformKey: string }} params
 * @returns {string}
 * @throws {Error} When no release asset maps to the platform key.
 */
function findAssetFileName({ platformKey }) {
    const assetFileName = Object.keys(PLATFORM_KEY_BY_ASSET_FILE_NAME).find(
        (candidateAssetFileName) => PLATFORM_KEY_BY_ASSET_FILE_NAME[candidateAssetFileName] === platformKey,
    );
    assertValue({
        condition: Boolean(assetFileName),
        message: `No release asset maps to platform key ${platformKey}.`,
    });
    return assetFileName;
}

/**
 * Count the symbolic links anywhere under a directory, without following them.
 * @param {{ directoryPath: string }} params
 * @returns {number}
 */
function countSymbolicLinks({ directoryPath }) {
    return readdirSync(directoryPath, { recursive: true, withFileTypes: true }).filter((directoryEntry) =>
        directoryEntry.isSymbolicLink(),
    ).length;
}

/**
 * Build the quarantine attribute value a browser records on a fresh download.
 * @returns {string} For example "0081;6a1f2c3d;Safari;".
 */
function buildQuarantineValue() {
    const downloadedAtHex = Math.floor(Date.now() / 1000).toString(16);
    return `${QUARANTINE_FLAGS};${downloadedAtHex};${QUARANTINE_AGENT_NAME};`;
}

/**
 * Run an assessment tool and capture its verdict; codesign and spctl both report on stderr.
 * @param {{ command: string, commandArguments: string[] }} params
 * @returns {Promise<{ isPassed: boolean, output: string }>}
 */
async function runAssessment({ command, commandArguments }) {
    try {
        const { stdout, stderr } = await execFileAsync(command, commandArguments);
        return { isPassed: true, output: `${stdout}${stderr}`.trim() };
    } catch (error) {
        return { isPassed: false, output: `${error.stdout ?? ""}${error.stderr ?? error.message}`.trim() };
    }
}

/**
 * Stream a URL to disk.
 * @param {{ url: string, destinationPath: string }} params
 * @returns {Promise<void>}
 * @throws {Error} When the server does not answer 2xx or the download times out.
 */
async function downloadFile({ url, destinationPath }) {
    const response = await fetch(url, { signal: AbortSignal.timeout(ARCHIVE_DOWNLOAD_TIMEOUT_MS) });
    assertValue({
        condition: response.ok && response.body !== null,
        message: `download failed (${response.status} ${response.statusText}).`,
    });
    await pipeline(Readable.fromWeb(response.body), createWriteStream(destinationPath));
}

/**
 * Hash a file with SHA-256.
 * @param {{ filePath: string }} params
 * @returns {Promise<string>} Lowercase hex digest.
 */
async function calculateSha256({ filePath }) {
    const hash = createHash("sha256");
    for await (const fileChunk of createReadStream(filePath)) {
        hash.update(fileChunk);
    }
    return hash.digest("hex");
}

/**
 * Read JSON file from disk.
 * @param {string} filePath
 * @returns {Record<string, any>}
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

export { buildQuarantineValue, countSymbolicLinks, listPinnedMacArchives };
