import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildClaudeCodeEnv,
  checkClaudeCodeReadiness,
  runClaudeCodeCommand,
} from "../shared/llm-source/claude-code-readiness.js";
import { CLAUDE_CODE_SESSION_LINK_ENV_VARS } from "../shared/llm-source/llm-source-constants.js";
import { ClaudeCodeReadiness, type IClaudeCodeCommandResult } from "../shared/llm-source/llm-source-types.js";

const childProcessMocks = vi.hoisted(() => ({ spawnSync: vi.fn() }));

vi.mock("node:child_process", () => childProcessMocks);

const INSTALLED_VERSION_LINE = "2.1.308 (Claude Code)";

/** Answers `--version` and `auth status` from fixed results, recording the arguments of each call. */
function scriptedClaudeCode(versionResult: IClaudeCodeCommandResult, authStatusResult?: IClaudeCodeCommandResult) {
  const invokedArgs: string[][] = [];
  const runClaudeCode = (args: readonly string[]): IClaudeCodeCommandResult => {
    invokedArgs.push([...args]);
    if (args[0] === "--version") {
      return versionResult;
    }
    return authStatusResult ?? { exitCode: 0, stdout: "" };
  };
  return { runClaudeCode: runClaudeCode, invokedArgs: invokedArgs };
}

const installedVersionResult: IClaudeCodeCommandResult = { exitCode: 0, stdout: `${INSTALLED_VERSION_LINE}\n` };

describe("checkClaudeCodeReadiness", () => {
  it("reports ready when Claude Code says it is signed in", () => {
    const { runClaudeCode, invokedArgs } = scriptedClaudeCode(installedVersionResult, {
      exitCode: 0,
      stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }),
    });

    expect(checkClaudeCodeReadiness(runClaudeCode)).toEqual({
      readiness: ClaudeCodeReadiness.Ready,
      installedVersion: INSTALLED_VERSION_LINE,
    });
    expect(invokedArgs).toEqual([["--version"], ["auth", "status"]]);
  });

  it("reports not installed when no claude executable is on the PATH", () => {
    const { runClaudeCode, invokedArgs } = scriptedClaudeCode({ exitCode: null, stdout: "", spawnErrorCode: "ENOENT" });

    expect(checkClaudeCodeReadiness(runClaudeCode)).toEqual({ readiness: ClaudeCodeReadiness.NotInstalled });
    expect(invokedArgs).toEqual([["--version"]]);
  });

  it("reports not installed when claude --version fails", () => {
    const { runClaudeCode } = scriptedClaudeCode({ exitCode: 1, stdout: "" });

    expect(checkClaudeCodeReadiness(runClaudeCode).readiness).toBe(ClaudeCodeReadiness.NotInstalled);
  });

  it("reports signed out when Claude Code says it is not signed in", () => {
    const { runClaudeCode } = scriptedClaudeCode(installedVersionResult, {
      exitCode: 1,
      stdout: JSON.stringify({ loggedIn: false }),
    });

    expect(checkClaudeCodeReadiness(runClaudeCode)).toEqual({
      readiness: ClaudeCodeReadiness.SignedOut,
      installedVersion: INSTALLED_VERSION_LINE,
    });
  });

  it("reports signed out when the sign-in status is not readable", () => {
    const { runClaudeCode } = scriptedClaudeCode(installedVersionResult, { exitCode: 0, stdout: "Logged in" });

    expect(checkClaudeCodeReadiness(runClaudeCode).readiness).toBe(ClaudeCodeReadiness.SignedOut);
  });
});

describe("buildClaudeCodeEnv", () => {
  it("drops every session-link variable and keeps the rest", () => {
    const parentEnv: NodeJS.ProcessEnv = { PATH: "/usr/bin", HOME: "/home/user" };
    for (const sessionLinkVar of CLAUDE_CODE_SESSION_LINK_ENV_VARS) {
      parentEnv[sessionLinkVar] = "parent-session";
    }

    const childEnv = buildClaudeCodeEnv(parentEnv);

    expect(childEnv).toEqual({ PATH: "/usr/bin", HOME: "/home/user" });
    expect(parentEnv.CLAUDECODE).toBe("parent-session");
  });
});

describe("runClaudeCodeCommand", () => {
  beforeEach(() => {
    childProcessMocks.spawnSync.mockReset();
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("CLAUDE_CODE_SESSION_ID", "parent-session");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs claude without the parent session's link variables", () => {
    childProcessMocks.spawnSync.mockReturnValue({ status: 0, stdout: `${INSTALLED_VERSION_LINE}\n` });

    expect(runClaudeCodeCommand(["--version"])).toEqual({
      exitCode: 0,
      stdout: `${INSTALLED_VERSION_LINE}\n`,
      spawnErrorCode: undefined,
    });

    const [executable, args, options] = childProcessMocks.spawnSync.mock.calls[0];
    expect(executable).toBe("claude");
    expect(args).toEqual(["--version"]);
    expect(options.env).not.toHaveProperty("CLAUDECODE");
    expect(options.env).not.toHaveProperty("CLAUDE_CODE_SESSION_ID");
    expect(options.windowsHide).toBe(true);
  });

  it("returns a missing executable as a spawn error code instead of throwing", () => {
    childProcessMocks.spawnSync.mockReturnValue({
      status: null,
      stdout: null,
      error: Object.assign(new Error("spawnSync claude ENOENT"), { code: "ENOENT" }),
    });

    expect(runClaudeCodeCommand(["--version"])).toEqual({ exitCode: null, stdout: "", spawnErrorCode: "ENOENT" });
  });
});
