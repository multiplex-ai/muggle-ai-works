import { spawn } from "child_process";
import { closeSync, existsSync, openSync } from "fs";
import { join, win32 } from "path";
import { resolveWatchPreferences } from "../pr-watch/watchPreferences.js";
import { PR_WATCH_ARM_SCRIPT_RELATIVE_PATH, SERVICE_LOOP_OUTPUT_FILE, SERVICE_WATCH_LISTENER } from "./constants.js";
import { findShippedFile } from "./service-installer.js";
import type { CommandRunner, ServiceLoopLauncher } from "./types.js";

// `bash` on a Windows PATH is as likely WSL's as Git's, so Git Bash is found
// beside git.exe or in its standard install dirs instead.
function windowsGitBashCandidates(runCommand: CommandRunner, env: NodeJS.ProcessEnv): string[] {
  const gitExecutables = (runCommand("where", ["git"])?.stdout ?? "").split(/\r?\n/).filter(Boolean);
  const installRoots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, "Programs")];
  return [
    ...(env.MUGGLE_HOOK_BASH ? [env.MUGGLE_HOOK_BASH] : []),
    ...gitExecutables.map((gitExecutable) => win32.join(win32.dirname(gitExecutable), "..", "bin", "bash.exe")),
    ...installRoots.flatMap((installRoot) => (installRoot ? [win32.join(installRoot, "Git", "bin", "bash.exe")] : [])),
  ];
}

/** The bash a PR watch loop runs under: Git Bash on Windows, `bash` elsewhere; null when Windows has none. */
export function resolveLoopBash(platform: NodeJS.Platform, runCommand: CommandRunner, env: NodeJS.ProcessEnv): string | null {
  if (platform !== "win32") return "bash";
  return windowsGitBashCandidates(runCommand, env).find((candidate) => existsSync(candidate)) ?? null;
}

// Git Bash reads a backslash in an argument as an escape, so paths go over with forward slashes.
function toBashPath(nativePath: string): string {
  return nativePath.replace(/\\/g, "/");
}

/**
 * A launcher that runs `pr-watch-arm.sh` detached, so the loop outlives the
 * tick and answers to no session. The loop records the watch as its listener,
 * and the session id is withheld so the arm never claims the slot for whoever
 * ran the tick.
 */
export function createServiceLoopLauncher(platform: NodeJS.Platform, runCommand: CommandRunner, env: NodeJS.ProcessEnv = process.env): ServiceLoopLauncher {
  return (slotDir, pr, baseBranch) => {
    const bash = resolveLoopBash(platform, runCommand, env);
    const armScript = findShippedFile(PR_WATCH_ARM_SCRIPT_RELATIVE_PATH);
    if (!bash || !armScript) return false;
    const lifetimeSeconds = resolveWatchPreferences().watcherLifetimeSeconds;
    const loopEnv: NodeJS.ProcessEnv = { ...env, MUGGLE_PR_WATCH_LISTENER: SERVICE_WATCH_LISTENER };
    delete loopEnv.CLAUDE_CODE_SESSION_ID;
    if (loopEnv.MUGGLE_PR_WATCH_MAX_LIFETIME === undefined && lifetimeSeconds !== undefined) {
      loopEnv.MUGGLE_PR_WATCH_MAX_LIFETIME = String(lifetimeSeconds);
    }
    const args = [toBashPath(armScript), "--slot", toBashPath(slotDir), "--repo", pr.repo, "--pr", String(pr.number), "--base", baseBranch];
    let outputFd: number | undefined;
    try {
      outputFd = openSync(join(slotDir, SERVICE_LOOP_OUTPUT_FILE), "w");
      const child = spawn(bash, args, { detached: true, stdio: ["ignore", outputFd, outputFd], env: loopEnv, windowsHide: true });
      child.on("error", () => undefined);
      child.unref();
      return child.pid !== undefined;
    } catch {
      return false;
    } finally {
      if (outputFd !== undefined) closeSync(outputFd);
    }
  };
}
