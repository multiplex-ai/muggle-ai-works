import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReloadAction,
  WatcherRecoveryOutcome,
  WatchFindingCode,
  WatchFindingSeverity,
  type WatchSnapshot,
} from "../../watch/types.js";

const serviceMock = vi.hoisted(() => ({
  createDefaultWatchTickDeps: vi.fn((options: unknown) => ({ options: options })),
  loadLastWatchSnapshot: vi.fn(),
  registerWatchSlot: vi.fn(),
  runReloadPluginsPass: vi.fn(),
  runWatchTick: vi.fn(),
  unregisterWatchSlot: vi.fn(),
}));

vi.mock("../../watch/watch-service.js", () => serviceMock);

import {
  watchRegisterCommand,
  watchReloadPluginsCommand,
  watchStatusCommand,
  watchTickCommand,
  watchUnregisterCommand,
} from "../../cli/watch.js";

const snapshot: WatchSnapshot = {
  takenAt: new Date().toISOString(),
  sessions: [],
  processes: [],
  slots: [],
  findings: [
    { key: "a", code: WatchFindingCode.WatcherDead, severity: WatchFindingSeverity.Alert, subject: "o/r#1", message: "dead" },
    { key: "w", code: WatchFindingCode.BehindBase, severity: WatchFindingSeverity.Warning, subject: "o/r#1", message: "behind" },
  ],
  recoveries: [{ ownerSessionId: "o1", slotSlugs: ["s"], outcome: WatcherRecoveryOutcome.Resumed }],
};

let stdout: string;
let stderr: string;

beforeEach(() => {
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("watchTickCommand", () => {
  it("runs a tick with the flag switches and prints a summary line", () => {
    serviceMock.runWatchTick.mockReturnValue(snapshot);
    watchTickCommand({ autoReload: false, recovery: true });
    expect(serviceMock.createDefaultWatchTickDeps).toHaveBeenCalledWith({ isAutoReloadEnabled: false, isRecoveryEnabled: true });
    expect(stdout).toBe("muggle watch: 0 sessions, 0 PR watches, 2 findings (1 alerts), 1 owner sessions resumed\n");
  });

  it("prints the snapshot as JSON on request", () => {
    serviceMock.runWatchTick.mockReturnValue(snapshot);
    watchTickCommand({ autoReload: true, recovery: true, json: true });
    expect(JSON.parse(stdout).findings).toHaveLength(2);
  });

  it("fails the process when the tick throws", () => {
    serviceMock.runWatchTick.mockImplementation(() => {
      throw new Error("another muggle watch run holds the lock");
    });
    watchTickCommand({ autoReload: true, recovery: true });
    expect(stderr).toBe("muggle watch: another muggle watch run holds the lock\n");
    expect(process.exitCode).toBe(1);
  });
});

describe("watchStatusCommand", () => {
  it("renders the last snapshot, or JSON on request", () => {
    serviceMock.loadLastWatchSnapshot.mockReturnValue(snapshot);
    watchStatusCommand({});
    expect(stdout).toContain("Findings: 2");
    stdout = "";
    watchStatusCommand({ json: true });
    expect(JSON.parse(stdout).takenAt).toBe(snapshot.takenAt);
  });

  it("explains how to start the service before the first tick", () => {
    serviceMock.loadLastWatchSnapshot.mockReturnValue(null);
    watchStatusCommand({});
    expect(stderr).toContain("install-muggle-watch.ps1");
    expect(process.exitCode).toBe(1);
  });
});

describe("watchReloadPluginsCommand", () => {
  const report = {
    decisions: [
      { sessionId: "s1", shortId: "s1", name: "fix", action: ReloadAction.Respawn, reason: "idle background session" },
      { sessionId: "s2", action: ReloadAction.Respawn, reason: "idle background session" },
      { sessionId: "s3", shortId: "s3", action: ReloadAction.Defer, reason: "turn in flight (busy)" },
    ],
    respawnedSessionIds: ["s1"],
    failedSessionIds: ["s2"],
  };

  it("lists each session's decision after a real pass", () => {
    serviceMock.runReloadPluginsPass.mockReturnValue(report);
    watchReloadPluginsCommand({});
    expect(serviceMock.runReloadPluginsPass).toHaveBeenCalledWith(expect.anything(), false);
    expect(stdout).toContain("muggle watch reload-plugins: respawned 1");
    expect(stdout).toContain("respawn       fix  idle background session");
    expect(stdout).toContain("s2  idle background session (respawn failed)");
  });

  it("counts planned respawns in a dry run, and prints JSON on request", () => {
    serviceMock.runReloadPluginsPass.mockReturnValue({ ...report, respawnedSessionIds: [], failedSessionIds: [] });
    watchReloadPluginsCommand({ dryRun: true });
    expect(serviceMock.runReloadPluginsPass).toHaveBeenCalledWith(expect.anything(), true);
    expect(stdout).toContain("would respawn 2");
    stdout = "";
    watchReloadPluginsCommand({ json: true });
    expect(JSON.parse(stdout).decisions).toHaveLength(3);
  });

  it("fails when sessions cannot be listed or the pass throws", () => {
    serviceMock.runReloadPluginsPass.mockReturnValue(null);
    watchReloadPluginsCommand({});
    expect(stderr).toContain("claude agents --json");
    serviceMock.runReloadPluginsPass.mockImplementation(() => {
      throw "locked";
    });
    watchReloadPluginsCommand({});
    expect(stderr).toContain("muggle watch: locked");
    expect(process.exitCode).toBe(1);
  });
});

describe("watchRegisterCommand / watchUnregisterCommand", () => {
  it("registers a slot and reports a refusal", () => {
    watchRegisterCommand({ slot: "/s/csv" });
    expect(serviceMock.registerWatchSlot).toHaveBeenCalledWith("/s/csv");
    expect(stdout).toBe("muggle watch: registered /s/csv\n");
    serviceMock.registerWatchSlot.mockImplementation(() => {
      throw new Error("/s/empty has no prs.json — arm the watch before registering it");
    });
    watchRegisterCommand({ slot: "/s/empty" });
    expect(stderr).toContain("has no prs.json");
    expect(process.exitCode).toBe(1);
  });

  it("says whether a slot was registered before unregistering it", () => {
    serviceMock.unregisterWatchSlot.mockReturnValueOnce(true).mockReturnValueOnce(false);
    watchUnregisterCommand({ slot: "/s/csv" });
    watchUnregisterCommand({ slot: "/s/csv" });
    expect(stdout).toBe("muggle watch: unregistered /s/csv\nmuggle watch: was not registered: /s/csv\n");
  });
});
