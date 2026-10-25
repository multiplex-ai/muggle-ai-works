import { spawnSync } from "child_process";
import { WATCH_COMMAND_MAX_BUFFER_BYTES, WATCH_COMMAND_TIMEOUT_MS } from "./constants.js";
import type { CommandRunner } from "./types.js";

/**
 * Runs an executable with no shell and no console window, keeping stdout even on
 * a non-zero exit: `gh api graphql` exits 1 when one PR in a batch errors while
 * still printing every other PR's data.
 */
export const defaultCommandRunner: CommandRunner = (executable, args, options) => {
  const spawned = spawnSync(executable, args, {
    cwd: options?.cwd,
    encoding: "utf-8",
    maxBuffer: WATCH_COMMAND_MAX_BUFFER_BYTES,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: options?.timeoutMs ?? WATCH_COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  if (spawned.error || spawned.status === null) return null;
  return { exitCode: spawned.status, stdout: spawned.stdout };
};
