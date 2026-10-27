/**
 * Ask the user's Claude Code whether it is installed and signed in — the checks Studio runs before
 * its first model call. Claude Code answers for itself: its stored sign-in is never read, and a
 * sign-in is never started.
 */

import { spawnSync } from "node:child_process";

import {
  CLAUDE_CODE_AUTH_STATUS_ARGS,
  CLAUDE_CODE_CHECK_TIMEOUT_MS,
  CLAUDE_CODE_EXECUTABLE,
  CLAUDE_CODE_EXECUTABLE_NOT_FOUND_CODE,
  CLAUDE_CODE_SESSION_LINK_ENV_VARS,
  CLAUDE_CODE_VERSION_ARGS,
} from "./llm-source-constants.js";
import {
  ClaudeCodeReadiness,
  type ClaudeCodeCommandRunner,
  type IClaudeCodeAuthStatus,
  type IClaudeCodeCommandResult,
  type IClaudeCodeReadinessReport,
} from "./llm-source-types.js";

/**
 * Copy an environment without the variables that tie a child process to a running Claude Code session.
 * @param parentEnv - The environment to copy.
 * @returns A copy without the session-link variables.
 */
export function buildClaudeCodeEnv(parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...parentEnv };
  for (const sessionLinkVar of CLAUDE_CODE_SESSION_LINK_ENV_VARS) {
    delete childEnv[sessionLinkVar];
  }
  return childEnv;
}

/**
 * Run `claude` once. Never throws: a missing executable comes back as `spawnErrorCode`.
 * @param args - Arguments to pass.
 */
export function runClaudeCodeCommand(args: readonly string[]): IClaudeCodeCommandResult {
  const completed = spawnSync(CLAUDE_CODE_EXECUTABLE, [...args], {
    encoding: "utf-8",
    env: buildClaudeCodeEnv(process.env),
    timeout: CLAUDE_CODE_CHECK_TIMEOUT_MS,
    windowsHide: true,
  });
  return {
    exitCode: completed.status,
    stdout: completed.stdout ?? "",
    spawnErrorCode: (completed.error as NodeJS.ErrnoException | undefined)?.code,
  };
}

function isSignedIn(authStatusOutput: string): boolean {
  try {
    return (JSON.parse(authStatusOutput) as IClaudeCodeAuthStatus).loggedIn === true;
  } catch {
    return false;
  }
}

/**
 * Ask Claude Code whether it is installed and signed in.
 * @param runClaudeCode - Runs `claude`; defaults to the installed executable.
 */
export function checkClaudeCodeReadiness(
  runClaudeCode: ClaudeCodeCommandRunner = runClaudeCodeCommand,
): IClaudeCodeReadinessReport {
  const versionResult = runClaudeCode(CLAUDE_CODE_VERSION_ARGS);
  if (versionResult.spawnErrorCode === CLAUDE_CODE_EXECUTABLE_NOT_FOUND_CODE || versionResult.exitCode !== 0) {
    return { readiness: ClaudeCodeReadiness.NotInstalled };
  }

  const installedVersion = versionResult.stdout.trim();
  const authStatusResult = runClaudeCode(CLAUDE_CODE_AUTH_STATUS_ARGS);
  return {
    readiness: isSignedIn(authStatusResult.stdout) ? ClaudeCodeReadiness.Ready : ClaudeCodeReadiness.SignedOut,
    installedVersion: installedVersion,
  };
}
