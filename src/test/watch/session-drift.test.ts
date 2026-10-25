import { writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { TRUST_PROBE_PROMPT, TRUST_PROBE_SESSION_NAME } from "../../watch/constants.js";
import { readInstallHistory } from "../../watch/install-history.js";
import { findWatchInstallerScript, isWatchTaskRegistered } from "../../watch/service-installer.js";
import { resolveReloadTargetAtMs, stampSessionLoads, versionInstalledAt } from "../../watch/session-drift.js";
import { TrackedProcessKind, WorkSessionAgent, type ProcessTableEntry, type WorkSession } from "../../watch/types.js";
import { canRestartSessionIn } from "../../watch/workspace-trust.js";
import { makeTempDir, scriptedRunner, succeeded } from "./fixtures.js";

const NOW_MS = Date.parse("2026-10-25T21:00:00Z");

describe("readInstallHistory", () => {
  it("keeps only installs that pointed Claude at the package, oldest first", () => {
    const installLogFile = join(makeTempDir("install-log"), "postinstall.log");
    writeFileSync(installLogFile, [
      "Postinstall started at 2026-10-25T20:31:53.440Z",
      "Claude plugin sync updated: loading 5.26.0-staging.198 from C:\\npm\\node_modules\\@muggleai\\works.",
      "Postinstall started at 2026-10-25T20:34:43.989Z",
      "Claude plugin sync skipped: not a global install.",
      "Postinstall started at not-a-date",
      "Claude plugin sync updated: loading 0.0.0 from /x.",
      "Postinstall started at 2026-10-25T20:45:16.176Z",
      "Claude plugin sync updated: loading 5.26.0-staging.199 from C:\\npm\\node_modules\\@muggleai\\works.",
    ].join("\r\n"));
    expect(readInstallHistory(installLogFile)).toEqual([
      { atMs: Date.parse("2026-10-25T20:31:53.440Z"), version: "5.26.0-staging.198" },
      { atMs: Date.parse("2026-10-25T20:45:16.176Z"), version: "5.26.0-staging.199" },
    ]);
  });

  it("reads a missing log as no history", () => {
    expect(readInstallHistory(join(makeTempDir("install-log"), "absent.log"))).toEqual([]);
  });
});

describe("versionInstalledAt / resolveReloadTargetAtMs", () => {
  const installs = [{ atMs: 100, version: "1" }, { atMs: 200, version: "2" }];

  it("names the newest install at or before a moment", () => {
    expect(versionInstalledAt(installs, 50)).toBeUndefined();
    expect(versionInstalledAt(installs, 100)).toBe("1");
    expect(versionInstalledAt(installs, 199)).toBe("1");
    expect(versionInstalledAt(installs, 500)).toBe("2");
  });

  it("targets the later of the newest install and the newest plugin update", () => {
    expect(resolveReloadTargetAtMs(installs, undefined)).toBe(200);
    expect(resolveReloadTargetAtMs(installs, 300)).toBe(300);
    expect(resolveReloadTargetAtMs(installs, 150)).toBe(200);
    expect(resolveReloadTargetAtMs([], 150)).toBe(150);
    expect(resolveReloadTargetAtMs([], undefined)).toBeUndefined();
  });
});

describe("stampSessionLoads", () => {
  const minuteMs = 60_000;
  const table: ProcessTableEntry[] = [
    { pid: 10, parentPid: 1, executableName: "claude", commandLine: "claude", ageMs: 60 * minuteMs },
    { pid: 11, parentPid: 10, executableName: "bash", commandLine: "bash -c muggle serve", ageMs: 5 * minuteMs },
    { pid: 12, parentPid: 11, executableName: "node", commandLine: "node /g/@muggleai/works/bin/muggle.js serve", ageMs: 5 * minuteMs },
    { pid: 20, parentPid: 1, executableName: "claude", commandLine: "claude", ageMs: 30 * minuteMs },
  ];
  const tracked = [
    { pid: 12, parentPid: 11, kind: TrackedProcessKind.MuggleMcpServer, ageMs: 5 * minuteMs },
    { pid: 99, parentPid: 98, kind: TrackedProcessKind.MuggleMcpServer, ageMs: minuteMs },
  ];
  const installs = [{ atMs: NOW_MS - 45 * minuteMs, version: "new" }, { atMs: NOW_MS - 90 * minuteMs, version: "old" }].reverse();

  function claude(sessionId: string, pid?: number): WorkSession {
    return { agent: WorkSessionAgent.Claude, sessionId: sessionId, pid: pid };
  }

  it("dates a session from its newest muggle MCP server start, else its process start", () => {
    const stamped = stampSessionLoads(
      [claude("reloaded", 10), claude("plain", 20), claude("no-pid"), claude("gone", 30), { agent: WorkSessionAgent.Codex, sessionId: "codex", pid: 20 }],
      table,
      tracked,
      installs,
      NOW_MS,
    );
    expect(stamped.map((session) => [session.sessionId, session.loadedAtMs, session.loadedVersion])).toEqual([
      ["reloaded", NOW_MS - 5 * minuteMs, "new"],
      ["plain", NOW_MS - 30 * minuteMs, "new"],
      ["no-pid", undefined, undefined],
      ["gone", undefined, undefined],
      ["codex", undefined, undefined],
    ]);
  });
});

describe("canRestartSessionIn", () => {
  it("confirms a restartable workspace by starting, stopping, and removing a probe session there", () => {
    const runner = scriptedRunner((_, args) => (args[0] === "--bg" ? succeeded(`backgrounded · ab12cd34 · ${TRUST_PROBE_SESSION_NAME}`) : succeeded("")));
    expect(canRestartSessionIn("/repo", runner.runCommand)).toBe(true);
    expect(runner.calls.map((call) => call.args)).toEqual([
      ["--bg", "--name", TRUST_PROBE_SESSION_NAME, TRUST_PROBE_PROMPT],
      ["stop", "ab12cd34"],
      ["rm", "ab12cd34"],
    ]);
    expect(runner.calls[0].options?.cwd).toBe("/repo");
  });

  it("reads a refusal, an unconfirmed start, or no answer as not restartable", () => {
    expect(canRestartSessionIn("/repo", scriptedRunner(() => ({ exitCode: 1, stdout: "" })).runCommand)).toBe(false);
    expect(canRestartSessionIn("/repo", scriptedRunner(() => succeeded("started")).runCommand)).toBe(false);
    expect(canRestartSessionIn("/repo", scriptedRunner(() => null).runCommand)).toBe(false);
    expect(canRestartSessionIn("/repo", scriptedRunner(() => succeeded("backgrounded · ab12 Workspace not trusted")).runCommand)).toBe(false);
  });
});

describe("service installer lookup", () => {
  it("finds the shipped installer from this module, and nothing outside a package", () => {
    expect(findWatchInstallerScript()).toMatch(/scripts[\\/]muggle-watch[\\/]install-muggle-watch\.ps1$/);
    expect(findWatchInstallerScript(makeTempDir("no-package"))).toBeNull();
  });

  it("asks Task Scheduler whether the task is registered", () => {
    const runner = scriptedRunner(() => succeeded(""));
    expect(isWatchTaskRegistered(runner.runCommand)).toBe(true);
    expect(runner.calls[0]).toMatchObject({ executable: "schtasks.exe", args: ["/Query", "/TN", "MuggleWatch"] });
    expect(isWatchTaskRegistered(scriptedRunner(() => null).runCommand)).toBe(false);
  });
});
