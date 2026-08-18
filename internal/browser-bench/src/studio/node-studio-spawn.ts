import { spawn } from "node:child_process";

import { BROWSER_PROFILE_DIR_ENV_VAR, STDERR_TAIL_LIMIT } from "./constants";
import { buildStudioArgv } from "./studio-invocation";
import { type StudioExitReport, type StudioInvocation, type StudioProcess } from "./types";

const killProcessTree = (pid: number | undefined): void => {
  if (pid === undefined) return;

  if (process.platform === "win32") {
    // Studio is Electron: killing the pid alone strands its renderer and GPU children.
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The process can exit between the timeout firing and the signal landing.
  }
};

/**
 * Starts one studio process against the benchmark contract and exposes it as a
 * promise plus a kill switch, so the timeout policy can live with the runner
 * instead of being buried in this adapter.
 *
 * Output shape: `{ exitReport: Promise<{ exitCode: 0, stderrTail: "" }>, kill: () => void }`
 */
export const spawnStudioProcess = (invocation: StudioInvocation): StudioProcess => {
  const child = spawn(invocation.studioBinPath, buildStudioArgv(invocation), {
    env: { ...process.env, [BROWSER_PROFILE_DIR_ENV_VAR]: invocation.browserProfileDir },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });

  let stderrTail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-STDERR_TAIL_LIMIT);
  });

  const exitReport = new Promise<StudioExitReport>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode: exitCode, stderrTail: stderrTail }));
  });

  return {
    exitReport: exitReport,
    kill: () => killProcessTree(child.pid),
  };
};
