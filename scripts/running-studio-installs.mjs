import { spawnSync } from "node:child_process";
import { platform } from "node:os";

const PROCESS_LIST_TIMEOUT_MS = 15_000;

const WINDOWS_PROCESS_PATHS_COMMAND = "Get-CimInstance Win32_Process | ForEach-Object { $_.ExecutablePath }";

const IS_CASE_INSENSITIVE_PLATFORM = platform() === "win32";

/**
 * Normalize an install directory name for comparison with the names
 * {@link listRunningInstallDirectoryNames} returns.
 * @param {string} directoryName - Directory name under the Electron app directory.
 * @returns {string} The name, lower-cased where paths compare case-insensitively.
 */
export function normalizeInstallDirectoryName(directoryName) {
    return IS_CASE_INSENSITIVE_PLATFORM ? directoryName.toLowerCase() : directoryName;
}

/**
 * Names of the `appDir` subdirectories that any of the given process paths run from.
 * @param {object} params - Match parameters.
 * @param {string} params.appDir - Base Electron app directory.
 * @param {string[]} params.processPaths - Executable paths or command lines of running processes.
 * @param {boolean} params.isCaseInsensitive - Whether paths compare case-insensitively.
 * @returns {Set<string>} Directory names, lower-cased when `isCaseInsensitive`.
 */
export function findInstallDirectoryNamesInProcessPaths({ appDir, processPaths, isCaseInsensitive }) {
    const normalizePath = (pathText) => (isCaseInsensitive ? pathText.toLowerCase() : pathText);
    const appDirPrefix = normalizePath(appDir.replace(/[\\/]+$/, ""));
    const installDirectoryNames = new Set();
    for (const processPath of processPaths) {
        const normalizedProcessPath = normalizePath(processPath);
        let matchIndex = normalizedProcessPath.indexOf(appDirPrefix);
        while (matchIndex !== -1) {
            const afterPrefix = normalizedProcessPath.slice(matchIndex + appDirPrefix.length);
            const [, directoryName] = afterPrefix.match(/^[\\/]([^\\/]+)/) ?? [];
            if (directoryName) {
                installDirectoryNames.add(directoryName);
            }
            matchIndex = normalizedProcessPath.indexOf(appDirPrefix, matchIndex + 1);
        }
    }
    return installDirectoryNames;
}

function listProcessPaths() {
    const processList = IS_CASE_INSENSITIVE_PLATFORM
        ? spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_PROCESS_PATHS_COMMAND], {
              encoding: "utf-8",
              windowsHide: true,
              timeout: PROCESS_LIST_TIMEOUT_MS,
          })
        : spawnSync("ps", ["-A", "-ww", "-o", "command="], { encoding: "utf-8", timeout: PROCESS_LIST_TIMEOUT_MS });
    if (processList.error || processList.status !== 0) {
        return null;
    }
    return processList.stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
}

/**
 * Names of the studio install directories a running process executes from, so
 * an install never deletes a runner another session is using.
 * @param {object} params - Lookup parameters.
 * @param {string} params.appDir - Base Electron app directory.
 * @returns {Set<string> | null} Normalized directory names, or null when running processes could not be listed.
 */
export function listRunningInstallDirectoryNames({ appDir }) {
    const processPaths = listProcessPaths();
    if (processPaths === null) {
        return null;
    }
    return findInstallDirectoryNamesInProcessPaths({
        appDir: appDir,
        processPaths: processPaths,
        isCaseInsensitive: IS_CASE_INSENSITIVE_PLATFORM,
    });
}
