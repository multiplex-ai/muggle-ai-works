import { homedir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { ProviderPrState } from "../../guardrails/types.js";
import { defaultCommandRunner } from "../../watch/command-runner.js";
import { formatDuration, shortSessionId, shortSha } from "../../watch/format.js";
import { composeTickNotification, createDesktopNotifier } from "../../watch/notify.js";
import { resolveWatchPaths } from "../../watch/paths.js";
import { renderWatchStatus } from "../../watch/render.js";
import {
  ClaudeJobState,
  ClaudeSessionKind,
  ClaudeTurnStatus,
  CiRollupState,
  PrMergeStateStatus,
  ReloadAction,
  TrackedProcessKind,
  WatcherLiveness,
  WatcherRecoveryOutcome,
  WatchFindingCode,
  WatchFindingSeverity,
  WorkSessionAgent,
  type WatchFinding,
  type WatchSnapshot,
} from "../../watch/types.js";
import { scriptedRunner, succeeded } from "./fixtures.js";

function alert(subject: string, severity = WatchFindingSeverity.Alert): WatchFinding {
  return { key: subject, code: WatchFindingCode.CiFailing, severity: severity, subject: subject, message: "checks are failure" };
}

describe("composeTickNotification", () => {
  it("lists new alerts, attempted resumes, and sessions that must reload by hand", () => {
    const lines = composeTickNotification(
      [alert("o/r#1"), alert("o/r#2", WatchFindingSeverity.Warning)],
      [
        { ownerSessionId: "aaaaaaaa-1", slotSlugs: ["csv"], outcome: WatcherRecoveryOutcome.Resumed },
        { ownerSessionId: "bbbbbbbb-1", slotSlugs: ["x", "y"], outcome: WatcherRecoveryOutcome.ResumeFailed },
        { ownerSessionId: "cccccccc-1", slotSlugs: ["z"], outcome: WatcherRecoveryOutcome.CoolingDown },
      ],
      undefined,
    );
    expect(lines).toEqual([
      "o/r#1: checks are failure",
      "Resumed session aaaaaaaa to re-arm csv",
      "Could not resume session bbbbbbbb for x, y",
    ]);
    const reload = {
      decisions: [
        { sessionId: "dddddddd-1", name: "fix login", action: ReloadAction.NotifyManual, reason: "" },
        { sessionId: "eeeeeeee-1", action: ReloadAction.NotifyManual, reason: "" },
        { sessionId: "f", action: ReloadAction.Respawn, reason: "" },
      ],
      respawnedSessionIds: [],
      failedSessionIds: [],
    };
    expect(composeTickNotification([], [], reload)).toEqual(["Plugins changed — run /reload-plugins in: fix login, eeeeeeee"]);
  });

  it("collapses everything past the line cap into a count", () => {
    const lines = composeTickNotification([alert("a"), alert("b"), alert("c"), alert("d"), alert("e")], [], undefined);
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe("+2 more — muggle watch status");
    expect(composeTickNotification([], [], undefined)).toEqual([]);
  });
});

describe("createDesktopNotifier", () => {
  it("raises a Windows toast through an encoded script that cannot be broken by its text", () => {
    const runner = scriptedRunner(() => succeeded(""));
    createDesktopNotifier("win32", runner.runCommand)("Muggle Watch", ["it's red", "second"]);
    expect(runner.calls[0].executable).toBe("powershell.exe");
    const script = Buffer.from(runner.calls[0].args[runner.calls[0].args.length - 1], "base64").toString("utf16le");
    expect(script).toContain("ToastNotificationManager");
    expect(script).toContain("'it''s red\nsecond'");
  });

  it("uses Notification Center on macOS and notify-send elsewhere, and nothing for no lines", () => {
    const runner = scriptedRunner(() => succeeded(""));
    createDesktopNotifier("darwin", runner.runCommand)('Say "hi"', ["a\\b"]);
    createDesktopNotifier("linux", runner.runCommand)("T", ["body"]);
    createDesktopNotifier("linux", runner.runCommand)("T", []);
    expect(runner.calls).toEqual([
      { executable: "osascript", args: ["-e", 'display notification "a\\\\b" with title "Say \\"hi\\""'], options: undefined },
      { executable: "notify-send", args: ["T", "body"], options: undefined },
    ]);
  });
});

describe("format helpers", () => {
  it("formats durations to their two largest units", () => {
    expect(formatDuration(-5)).toBe("0m");
    expect(formatDuration(47 * 60_000)).toBe("47m");
    expect(formatDuration(125 * 60_000)).toBe("2h05m");
    expect(formatDuration((3 * 24 + 4) * 3_600_000)).toBe("3d04h");
  });

  it("shortens ids and shas", () => {
    expect(shortSessionId("1c714e7e-58b2")).toBe("1c714e7e");
    expect(shortSha("abcdef0123")).toBe("abcdef01");
    expect(shortSha(undefined)).toBe("?");
  });
});

describe("resolveWatchPaths", () => {
  it("follows the agents' home overrides", () => {
    const paths = resolveWatchPaths({ CLAUDE_CONFIG_DIR: "/c", CODEX_HOME: "/x" });
    expect(paths.claudeSessionRegistryDir).toBe(join("/c", "sessions"));
    expect(paths.claudeProjectsDir).toBe(join("/c", "projects"));
    expect(paths.claudeInstalledPluginsFile).toBe(join("/c", "plugins", "installed_plugins.json"));
    expect(paths.codexSessionsDir).toBe(join("/x", "sessions"));
  });

  it("defaults to the home dir layouts", () => {
    const paths = resolveWatchPaths({});
    expect(paths.watchDir).toBe(join(homedir(), ".muggle-ai", "watch"));
    expect(paths.slotsDir).toBe(join(homedir(), ".muggle-ai", "muggle-do", "sessions"));
    expect(paths.claudeSessionRegistryDir).toBe(join(homedir(), ".claude", "sessions"));
    expect(paths.codexSessionsDir).toBe(join(homedir(), ".codex", "sessions"));
  });
});

describe("defaultCommandRunner", () => {
  it("keeps stdout and the exit code of a failing command", () => {
    const outcome = defaultCommandRunner(process.execPath, ["-e", "process.stdout.write('partial'); process.exit(3)"]);
    expect(outcome).toEqual({ exitCode: 3, stdout: "partial" });
  });

  it("runs in the requested cwd and returns null for an executable that does not exist", () => {
    const cwd = homedir();
    expect(defaultCommandRunner(process.execPath, ["-e", "process.stdout.write(process.cwd())"], { cwd: cwd })?.stdout).toBe(cwd);
    expect(defaultCommandRunner("muggle-watch-no-such-binary", [])).toBeNull();
  });
});

describe("renderWatchStatus", () => {
  const takenAt = "2026-10-24T12:00:00.000Z";
  const snapshot: WatchSnapshot = {
    takenAt: takenAt,
    sessions: [
      {
        agent: WorkSessionAgent.Claude,
        sessionId: "1c714e7e-58b2",
        name: "watch service",
        cwd: "C:\\repo",
        kind: ClaudeSessionKind.Background,
        turnStatus: ClaudeTurnStatus.Busy,
        jobState: ClaudeJobState.Working,
      },
      { agent: WorkSessionAgent.Codex, sessionId: "codex-session-1" },
    ],
    processes: [
      { pid: 1, parentPid: 0, kind: TrackedProcessKind.ClaudeCli, isOrphaned: false },
      { pid: 2, parentPid: 0, kind: TrackedProcessKind.MuggleMcpServer, isOrphaned: true },
      { pid: 3, parentPid: 0, kind: TrackedProcessKind.PrWatchLoop, watchSlotSlug: "csv" },
    ],
    slots: [
      {
        slug: "csv",
        slotDir: "/s/csv",
        pr: { repo: "o/r", number: 7, url: "u7" },
        isRegistered: true,
        watcher: WatcherLiveness.Dead,
        ownerSessionId: "aaaaaaaa-1",
        isOwnerSessionActive: false,
        live: { url: "u7", state: ProviderPrState.Open, ciRollup: CiRollupState.Failure, mergeStateStatus: PrMergeStateStatus.Behind, unresolvedThreadCount: 0 },
      },
      { slug: "x", slotDir: "/s/x", pr: { repo: "o/r", number: 8, url: "u8" }, isRegistered: false, watcher: WatcherLiveness.Polling, ownerSessionId: "b", isOwnerSessionActive: undefined },
      { slug: "y", slotDir: "/s/y", pr: { repo: "o/r", number: 9, url: "u9" }, isRegistered: false, watcher: WatcherLiveness.Polling, isOwnerSessionActive: true, ownerSessionId: "c" },
      { slug: "z", slotDir: "/s/z", pr: { repo: "o/r", number: 10, url: "u10" }, isRegistered: false, watcher: WatcherLiveness.Polling },
    ],
    findings: [
      { key: "w", code: WatchFindingCode.BehindBase, severity: WatchFindingSeverity.Warning, subject: "o/r#7", message: "behind" },
      { key: "a", code: WatchFindingCode.WatcherDead, severity: WatchFindingSeverity.Alert, subject: "o/r#7", message: "dead" },
    ],
    recoveries: [{ ownerSessionId: "aaaaaaaa-1", slotSlugs: ["csv"], outcome: WatcherRecoveryOutcome.Resumed }],
    reload: {
      decisions: [
        { sessionId: "d", action: ReloadAction.Defer, reason: "" },
        { sessionId: "m", action: ReloadAction.NotifyManual, reason: "" },
      ],
      respawnedSessionIds: ["r"],
      failedSessionIds: [],
    },
  };

  it("renders every section, alerts before warnings", () => {
    const text = renderWatchStatus(snapshot, Date.parse(takenAt) + 3 * 60_000);
    expect(text).toContain("last tick 3m ago");
    expect(text).toContain("Sessions: 1 Claude, 1 Codex");
    expect(text).toMatch(/background\s+busy\/working\s+1c714e7e watch service {2}C:\\repo/);
    expect(text).toMatch(/codex\s+active\s+codex-se/);
    expect(text).toContain("1 claude, 0 codex, 1 muggle MCP servers (1 orphaned), 1 PR watch loop processes");
    expect(text).toMatch(/o\/r#7\s+dead\s+registered\s+owner aaaaaaaa \(ended\) {2}open, ci failure, behind/);
    expect(text).toContain("owner b (unknown)");
    expect(text).toContain("owner c (active)");
    expect(text).toMatch(/no owner {2}status unavailable/);
    expect(text.indexOf("WATCHER_DEAD")).toBeLessThan(text.indexOf("BEHIND_BASE"));
    expect(text).toContain("session aaaaaaaa  resumed  csv");
    expect(text).toContain("Plugin reload: 1 respawned, 0 failed, 1 deferred, 1 need /reload-plugins by hand");
  });

  it("leaves out recovery and reload sections when nothing happened", () => {
    const quiet = renderWatchStatus({ ...snapshot, recoveries: [], reload: undefined }, Date.parse(takenAt));
    expect(quiet).not.toContain("Recoveries:");
    expect(quiet).not.toContain("Plugin reload:");
  });
});
