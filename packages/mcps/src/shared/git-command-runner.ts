/** Runs git as a child process for checks that read repository state. */

import { execFile } from "node:child_process";

import { GIT_COMMAND_TIMEOUT_MS } from "./checkout-freshness-constants.js";
import type { GitCommandRunner } from "./checkout-freshness-types.js";

/**
 * Run one git command in `cwd`.
 *
 * @returns Trimmed stdout, or null when git exits non-zero, times out, or `cwd` does not exist.
 */
export const runGitCommand: GitCommandRunner = (args, cwd) =>
  new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd: cwd, timeout: GIT_COMMAND_TIMEOUT_MS, windowsHide: true, encoding: "utf-8" },
      (error, stdout) => {
        resolve(error ? null : stdout.trim());
      },
    );
  });
