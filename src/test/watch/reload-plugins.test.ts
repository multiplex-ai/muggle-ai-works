import { describe, expect, it } from "vitest";
import { advancePendingReload, executeReloadFanOut, planReloadFanOut } from "../../watch/reload-plugins.js";
import {
  ClaudeJobState,
  ClaudeSessionKind,
  ClaudeTurnStatus,
  ReloadAction,
  WorkSessionAgent,
  type PendingReload,
  type WorkSession,
} from "../../watch/types.js";
import { scriptedRunner, succeeded } from "./fixtures.js";

const CHANGED_AT_MS = 1_000_000;

function background(sessionId: string, overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    agent: WorkSessionAgent.Claude,
    sessionId: sessionId,
    shortId: sessionId.slice(0, 4),
    name: `name-${sessionId}`,
    kind: ClaudeSessionKind.Background,
    turnStatus: ClaudeTurnStatus.Idle,
    jobState: ClaudeJobState.Blocked,
    startedAtMs: CHANGED_AT_MS - 1,
    ...overrides,
  };
}

const pending: PendingReload = { fingerprint: "fp", changedAtMs: CHANGED_AT_MS, respawnedSessionIds: ["already"], notifiedSessionIds: ["told"] };

describe("planReloadFanOut", () => {
  it("respawns idle background sessions and handles every other session safely", () => {
    const sessions = [
      background("idle-1"),
      background("new", { startedAtMs: CHANGED_AT_MS }),
      background("already"),
      background("term", { kind: ClaudeSessionKind.Interactive }),
      background("told", { kind: ClaudeSessionKind.Interactive }),
      background("nokind", { kind: undefined }),
      background("noid", { shortId: undefined }),
      background("done", { jobState: ClaudeJobState.Done }),
      background("busy", { turnStatus: ClaudeTurnStatus.Busy }),
      background("unknown", { turnStatus: undefined }),
      { agent: WorkSessionAgent.Codex, sessionId: "codex" },
      background("idle-2", { startedAtMs: undefined }),
    ];
    const decisions = planReloadFanOut(sessions, pending, 1);
    expect(decisions.map((decision) => [decision.sessionId, decision.action, decision.reason])).toEqual([
      ["idle-1", ReloadAction.Respawn, "idle background session"],
      ["new", ReloadAction.Skip, "started after the plugin change"],
      ["already", ReloadAction.Skip, "already respawned"],
      ["term", ReloadAction.NotifyManual, "terminal session — run /reload-plugins in it"],
      ["told", ReloadAction.Skip, "already asked to run /reload-plugins"],
      ["nokind", ReloadAction.Skip, "not a background session the watch can respawn"],
      ["noid", ReloadAction.Skip, "not a background session the watch can respawn"],
      ["done", ReloadAction.Skip, "job finished"],
      ["busy", ReloadAction.Defer, "turn in flight (busy)"],
      ["unknown", ReloadAction.Defer, "turn in flight (unknown)"],
      ["idle-2", ReloadAction.Defer, "respawn cap reached this tick"],
    ]);
  });
});

describe("executeReloadFanOut", () => {
  it("respawns each planned session by its short id and records failures", () => {
    const runner = scriptedRunner((_, args) => (args[1] === "good" ? succeeded("") : { exitCode: 1, stdout: "" }));
    const report = executeReloadFanOut(
      [
        { sessionId: "s-good", shortId: "good", action: ReloadAction.Respawn, reason: "" },
        { sessionId: "s-bad", shortId: "bad", action: ReloadAction.Respawn, reason: "" },
        { sessionId: "s-defer", shortId: "defer", action: ReloadAction.Defer, reason: "" },
      ],
      runner.runCommand,
    );
    expect(runner.calls.map((call) => call.args)).toEqual([["respawn", "good"], ["respawn", "bad"]]);
    expect(report.respawnedSessionIds).toEqual(["s-good"]);
    expect(report.failedSessionIds).toEqual(["s-bad"]);
  });
});

describe("advancePendingReload", () => {
  it("finishes once nothing is deferred", () => {
    const report = { decisions: [{ sessionId: "a", action: ReloadAction.Respawn, reason: "" }], respawnedSessionIds: ["a"], failedSessionIds: [] };
    expect(advancePendingReload(pending, report)).toBeUndefined();
  });

  it("carries attempted and notified sessions while some are still deferred", () => {
    const report = {
      decisions: [
        { sessionId: "a", action: ReloadAction.Respawn, reason: "" },
        { sessionId: "b", action: ReloadAction.Respawn, reason: "" },
        { sessionId: "t", action: ReloadAction.NotifyManual, reason: "" },
        { sessionId: "d", action: ReloadAction.Defer, reason: "" },
      ],
      respawnedSessionIds: ["a"],
      failedSessionIds: ["b"],
    };
    expect(advancePendingReload(pending, report)).toEqual({
      fingerprint: "fp",
      changedAtMs: CHANGED_AT_MS,
      respawnedSessionIds: ["already", "a", "b"],
      notifiedSessionIds: ["told", "t"],
    });
  });
});
