import { closeSync, openSync, writeSync } from "node:fs";

import {
    POSIX_TERMINAL_DEVICE_PATH,
    POST_INSTALL_GUIDE_LINES,
    WINDOWS_TERMINAL_DEVICE_PATH,
} from "./constants.mjs";

export {
    POSIX_TERMINAL_DEVICE_PATH,
    POST_INSTALL_DOCS_URL,
    POST_INSTALL_GUIDE_LINES,
    WINDOWS_TERMINAL_DEVICE_PATH,
} from "./constants.mjs";

/**
 * Build the getting-started guide shown after install.
 * @returns {string} The guide as plain text.
 */
export function buildPostInstallGuide() {
    return POST_INSTALL_GUIDE_LINES.join("\n");
}

/**
 * Write text straight to the user's console device, bypassing stdout.
 * @param {string} devicePath - Console device to open.
 * @param {string} text - Text to write.
 * @throws When the device cannot be opened, as in a headless environment.
 */
export function writeToTerminalDevice(devicePath, text) {
    const fileDescriptor = openSync(devicePath, "w");
    try {
        writeSync(fileDescriptor, text);
    } finally {
        closeSync(fileDescriptor);
    }
}

/**
 * Show the guide to whoever ran the install.
 *
 * npm captures a lifecycle script's stdout during a global install and discards it on
 * success, so a plain `console.log` is never seen. When stdout is not a terminal the guide
 * is also written to the console device directly. CI and headless runs have no console to
 * reach, so that write is skipped there and its failure is swallowed.
 * @param {object} params - Output wiring.
 * @param {string} params.guide - Text to show.
 * @param {boolean} params.isStdoutTerminal - Whether stdout is an interactive terminal.
 * @param {NodeJS.ProcessEnv} params.env - Process environment.
 * @param {string} params.platformName - Value of `os.platform()`.
 * @param {(text: string) => void} params.writeToStdout - Writes the guide to stdout and the install log.
 * @param {(devicePath: string, text: string) => void} [params.writeToDevice] - Writes to a console device.
 * @returns {{ wroteToStdout: boolean, wroteToTerminalDevice: boolean }} Which outputs received the guide.
 */
export function showPostInstallGuide({
    guide,
    isStdoutTerminal,
    env,
    platformName,
    writeToStdout,
    writeToDevice = writeToTerminalDevice,
}) {
    writeToStdout(guide);

    if (isStdoutTerminal || env.CI) {
        return { wroteToStdout: true, wroteToTerminalDevice: false };
    }

    const devicePath = platformName === "win32" ? WINDOWS_TERMINAL_DEVICE_PATH : POSIX_TERMINAL_DEVICE_PATH;

    try {
        writeToDevice(devicePath, `\n${guide}\n\n`);
        return { wroteToStdout: true, wroteToTerminalDevice: true };
    } catch {
        return { wroteToStdout: true, wroteToTerminalDevice: false };
    }
}
