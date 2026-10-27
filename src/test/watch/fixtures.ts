import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CommandOptions, CommandOutcome, CommandRunner, WatchPaths } from "../../watch/types.js";

/** A runner that answers from `answer` and records every call it receives. */
export function scriptedRunner(answer: (executable: string, args: string[], options?: CommandOptions) => CommandOutcome | null): {
  runCommand: CommandRunner;
  calls: Array<{ executable: string; args: string[]; options?: CommandOptions }>;
} {
  const calls: Array<{ executable: string; args: string[]; options?: CommandOptions }> = [];
  return {
    calls: calls,
    runCommand: (executable, args, options) => {
      calls.push({ executable: executable, args: args, options: options });
      return answer(executable, args, options);
    },
  };
}

/** A command that exited 0 printing `stdout`. */
export function succeeded(stdout: string): CommandOutcome {
  return { exitCode: 0, stdout: stdout };
}

/** A fresh empty dir under the OS temp dir. */
export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

/** Watch paths rooted in one temp dir, none of them created. */
export function makeWatchPaths(root: string): WatchPaths {
  return {
    watchDir: join(root, "muggle", "watch"),
    slotsDir: join(root, "muggle", "muggle-do", "sessions"),
    claudeSessionRegistryDir: join(root, "claude", "sessions"),
    claudeProjectsDir: join(root, "claude", "projects"),
    claudeInstalledPluginsFile: join(root, "claude", "plugins", "installed_plugins.json"),
    codexSessionsDir: join(root, "codex", "sessions"),
    muggleInstallLogFile: join(root, "muggle", "postinstall.log"),
  };
}

/** Write a PR-watch slot dir with the files its options name; returns the slot dir. */
export function writeSlot(
  slotsDir: string,
  slug: string,
  slotFiles: {
    prsJson?: unknown;
    ownerSessionId?: string;
    heartbeatMtimeMs?: number;
    isRegistered?: boolean;
    isFinalized?: boolean;
    lastSeen?: unknown;
    followupLog?: string;
  },
): string {
  const slotDir = join(slotsDir, slug);
  mkdirSync(slotDir, { recursive: true });
  if (slotFiles.prsJson !== undefined) writeFileSync(join(slotDir, "prs.json"), JSON.stringify(slotFiles.prsJson));
  if (slotFiles.ownerSessionId) {
    writeFileSync(join(slotDir, "owner.json"), JSON.stringify({ session_id: slotFiles.ownerSessionId, claimed_at: "2026-10-24T00:00:00Z" }));
  }
  if (slotFiles.heartbeatMtimeMs !== undefined) {
    const heartbeatPath = join(slotDir, "watch-heartbeat");
    writeFileSync(heartbeatPath, "");
    utimesSync(heartbeatPath, slotFiles.heartbeatMtimeMs / 1000, slotFiles.heartbeatMtimeMs / 1000);
  }
  if (slotFiles.isRegistered) {
    writeFileSync(join(slotDir, "watch-registration.json"), JSON.stringify({ registered_at: "2026-10-24T00:00:00Z", registered_by: "test" }));
  }
  if (slotFiles.isFinalized) writeFileSync(join(slotDir, "result.md"), "done\n");
  if (slotFiles.lastSeen !== undefined) writeFileSync(join(slotDir, "last_seen.json"), JSON.stringify(slotFiles.lastSeen));
  if (slotFiles.followupLog !== undefined) writeFileSync(join(slotDir, "followup.log"), slotFiles.followupLog);
  return slotDir;
}

/** A `prs.json` entry for one open GitHub PR. */
export function openPrEntry(repo: string, prNumber: number): Record<string, unknown> {
  return { repo: repo, provider: "github", number: prNumber, url: `https://github.com/${repo}/pull/${prNumber}`, head_sha: "abc123", state: "open" };
}
