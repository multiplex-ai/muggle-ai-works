/** Stops a local service's whole process tree, so a launcher such as `npm run dev` goes down with the server it started. */

import { execFile } from "node:child_process";
import * as os from "node:os";

import { SERVICE_STOP_COMMAND_TIMEOUT_MS } from "./service-stack-constants.js";

/**
 * Stop a process and every process it started.
 *
 * @param pid - Root of the tree.
 */
export async function stopProcessTree(pid: number): Promise<void> {
  if (os.platform() === "win32") {
    await runStopCommand("taskkill", ["/PID", String(pid), "/T", "/F"]);
    return;
  }
  // A service started as its own process group goes down whole; one that was not still loses its root.
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGTERM");
    } catch {
      // Already gone, or not a process group leader.
    }
  }
}

// Resolves whatever the exit code: taskkill fails on a tree that already exited, which is the goal anyway.
function runStopCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: SERVICE_STOP_COMMAND_TIMEOUT_MS, windowsHide: true }, () => resolve());
  });
}
