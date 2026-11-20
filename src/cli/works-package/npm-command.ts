import { execFile } from "child_process";
import { platform } from "os";

import { NPM_COMMANDS_ENV, NPM_OUTPUT_MAX_BUFFER_BYTES } from "./constants.js";
import type { NpmCommandRunner } from "./types.js";

/** Runs the npm on PATH without a console window, keeping its output on a non-zero exit. */
export const runNpmCommand: NpmCommandRunner = (npmArguments, timeoutMs) => {
  if (process.env[NPM_COMMANDS_ENV] === "off") return Promise.resolve(undefined);

  // npm is a .cmd shim on Windows, which only cmd.exe can start.
  const isWindows = platform() === "win32";
  const executable = isWindows ? "cmd.exe" : "npm";
  const executableArguments = isWindows ? ["/d", "/s", "/c", "npm", ...npmArguments] : npmArguments;
  return new Promise((resolve) => {
    execFile(
      executable,
      executableArguments,
      { encoding: "utf-8", maxBuffer: NPM_OUTPUT_MAX_BUFFER_BYTES, timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        const exitCode = error ? error.code : 0;
        if (typeof exitCode !== "number") {
          resolve(undefined);
          return;
        }
        resolve({ exitCode: exitCode, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });
};
