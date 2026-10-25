import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReloadAction,
  WatcherRecoveryOutcome,
  WatchServiceInstallOutcome,
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
  installWatchService: vi.fn(),
  uninstallWatchService: vi.fn(),
  applyWatchServicePreference: vi.fn(),
  createDefaultWatchServiceInstallDeps: vi.fn(() => ({ platform: "win32" })),
}));

vi.mock("../../watch/watch-service.js", () => serviceMock);
vi.mock("../../../packages/mcps/src/index.js", async () => ({
  PreferenceKey: (await import("../../../packages/mcps/src/shared/preferences-types.js")).PreferenceKey,
  resolvePreferences: () => ({ autoInstallWatchService: "ask" }),
}));

import {
  watchInstallCommand,
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
  coverage: [],
  closedOutSlugs: [],
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
      { sessionId: "s4", shortId: "s4", cwd: "/locked", action: ReloadAction.ResumeReconcile, reason: "idle, owns open PR watches" },
    ],
    respawnedSessionIds: ["s1"],
    failedSessionIds: ["s2"],
    untrustedSessionIds: ["s4"],
  };

  it("lists each session's decision after a real pass", () => {
    serviceMock.runReloadPluginsPass.mockReturnValue(report);
    watchReloadPluginsCommand({});
    expect(serviceMock.runReloadPluginsPass).toHaveBeenCalledWith(expect.anything(), false);
    expect(stdout).toContain("muggle watch reload-plugins: restarted 1");
    expect(stdout).toContain("respawn          fix  idle background session");
    expect(stdout).toContain("s2  idle background session (restart failed)");
    expect(stdout).toContain("s4  idle, owns open PR watches (left running: /locked refuses a background restart — run /reload-plugins in it)");
  });

  it("counts planned respawns in a dry run, and prints JSON on request", () => {
    serviceMock.runReloadPluginsPass.mockReturnValue({ ...report, respawnedSessionIds: [], failedSessionIds: [], untrustedSessionIds: [] });
    watchReloadPluginsCommand({ dryRun: true });
    expect(serviceMock.runReloadPluginsPass).toHaveBeenCalledWith(expect.anything(), true);
    expect(stdout).toContain("would restart 3");
    stdout = "";
    watchReloadPluginsCommand({ json: true });
    expect(JSON.parse(stdout).decisions).toHaveLength(4);
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

describe("watchInstallCommand", () => {
  it("installs, uninstalls, or acts on the saved preference", () => {
    serviceMock.installWatchService.mockReturnValue({ outcome: WatchServiceInstallOutcome.Installed, detail: "task registered" });
    serviceMock.uninstallWatchService.mockReturnValue({ outcome: WatchServiceInstallOutcome.Removed, detail: "" });
    serviceMock.applyWatchServicePreference.mockReturnValue({ outcome: WatchServiceInstallOutcome.NotRequested, detail: "autoInstallWatchService is ask" });
    watchInstallCommand({ wait: false });
    watchInstallCommand({ wait: true, uninstall: true });
    watchInstallCommand({ wait: false, fromPreference: true });
    expect(serviceMock.installWatchService).toHaveBeenCalledWith({ platform: "win32" }, true);
    expect(serviceMock.applyWatchServicePreference).toHaveBeenCalledWith("ask", expect.anything(), true);
    expect(stdout).toBe(
      "muggle watch install: installed — task registered\nmuggle watch install: removed\nmuggle watch install: not-requested — autoInstallWatchService is ask\n",
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("fails on an installer failure, and on an unsupported platform only when asked directly", () => {
    serviceMock.installWatchService.mockReturnValue({ outcome: WatchServiceInstallOutcome.Unsupported, detail: "add a crontab line" });
    serviceMock.applyWatchServicePreference.mockReturnValue({ outcome: WatchServiceInstallOutcome.Unsupported, detail: "add a crontab line" });
    watchInstallCommand({ wait: true, fromPreference: true });
    expect(process.exitCode).toBeUndefined();
    watchInstallCommand({ wait: true });
    expect(stderr).toBe("muggle watch: unsupported: add a crontab line\n");
    expect(process.exitCode).toBe(1);
    serviceMock.installWatchService.mockReturnValue({ outcome: WatchServiceInstallOutcome.Failed, detail: "access denied" });
    watchInstallCommand({ wait: true });
    expect(stderr).toContain("failed: access denied");
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
