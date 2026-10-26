import { describe, expect, it } from "vitest";
import { advancePendingReload, executeReloadFanOut, planReloadFanOut } from "../../watch/reload-plugins.js";
import {
  ClaudeJobState,
  ClaudeSessionKind,
  ClaudeTurnStatus,
  ReloadAction,
  WorkSessionAgent,
  type PendingReload,
  type ReloadDecision,
  type WorkSession,
} from "../../watch/types.js";
import { RECOVERY_RESUME_PROMPT } from "../../watch/constants.js";
import { scriptedRunner, succeeded } from "./fixtures.js";

const CHANGED_AT_MS = 1_000_000;

function background(sessionId: string, overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    agent: WorkSessionAgent.Claude,
    sessionId: sessionId,
    shortId: sessionId.slice(0, 4),
    name: `name-${sessionId}`,
    cwd: `/work/${sessionId}`,
    pid: 100,
    kind: ClaudeSessionKind.Background,
    turnStatus: ClaudeTurnStatus.Idle,
    jobState: ClaudeJobState.Blocked,
    startedAtMs: CHANGED_AT_MS - 1,
    ...overrides,
  };
}

const pending: PendingReload = {
  changedAtMs: CHANGED_AT_MS,
  respawnedSessionIds: ["already"],
  notifiedSessionIds: ["told"],
  skippedSessionIds: ["untrusted"],
};

function decision(sessionId: string, action: ReloadAction, cwd = `/work/${sessionId}`): ReloadDecision {
  return { sessionId: `s-${sessionId}`, shortId: sessionId, cwd: cwd, action: action, reason: "" };
}

describe("planReloadFanOut", () => {
  it("restarts idle background sessions behind the install and handles every other session safely", () => {
    const sessions = [
      background("idle-1"),
      background("owner", { jobState: ClaudeJobState.Done }),
      background("gone", { pid: undefined, turnStatus: undefined }),
      background("new", { loadedAtMs: CHANGED_AT_MS }),
      background("reloaded", { startedAtMs: 1, loadedAtMs: CHANGED_AT_MS + 5 }),
      background("already"),
      background("untrusted"),
      background("term", { kind: ClaudeSessionKind.Interactive }),
      background("told", { kind: ClaudeSessionKind.Interactive }),
      background("nokind", { kind: undefined }),
      background("noid", { shortId: undefined }),
      background("busy", { turnStatus: ClaudeTurnStatus.Busy }),
      background("unknown", { turnStatus: undefined }),
      { agent: WorkSessionAgent.Codex, sessionId: "codex" },
      background("idle-2", { startedAtMs: undefined }),
    ];
    const decisions = planReloadFanOut(sessions, pending, new Set(["owner"]), 2);
    expect(decisions.map((planned) => [planned.sessionId, planned.action, planned.reason])).toEqual([
      ["idle-1", ReloadAction.Respawn, "idle background session"],
      ["owner", ReloadAction.ResumeReconcile, "idle, owns open PR watches"],
      ["gone", ReloadAction.Skip, "no live process"],
      ["new", ReloadAction.Skip, "already on the installed build"],
      ["reloaded", ReloadAction.Skip, "already on the installed build"],
      ["already", ReloadAction.Skip, "already handled for this install"],
      ["untrusted", ReloadAction.Skip, "already handled for this install"],
      ["term", ReloadAction.NotifyManual, "terminal session — run /reload-plugins in it"],
      ["told", ReloadAction.Skip, "already asked to run /reload-plugins"],
      ["nokind", ReloadAction.Skip, "not a background session the watch can restart"],
      ["noid", ReloadAction.Skip, "not a background session the watch can restart"],
      ["busy", ReloadAction.Defer, "turn in flight (busy)"],
      ["unknown", ReloadAction.Defer, "turn in flight (unknown)"],
      ["idle-2", ReloadAction.Defer, "restart cap reached this pass"],
    ]);
    expect(decisions[0].cwd).toBe("/work/idle-1");
  });
});

describe("executeReloadFanOut", () => {
  it("respawns, resumes watch owners on reconcile, and records failures", () => {
    const runner = scriptedRunner((_, args) => (args[1] === "bad" ? { exitCode: 1, stdout: "" } : succeeded("")));
    const report = executeReloadFanOut(
      [
        decision("good", ReloadAction.Respawn),
        decision("bad", ReloadAction.Respawn),
        decision("own", ReloadAction.ResumeReconcile),
        decision("defer", ReloadAction.Defer),
      ],
      runner.runCommand,
      () => true,
      () => true,
    );
    expect(runner.calls.map((call) => call.args)).toEqual([
      ["respawn", "good"],
      ["respawn", "bad"],
      ["stop", "own"],
      ["--resume", "s-own", "--bg", RECOVERY_RESUME_PROMPT],
    ]);
    expect(runner.calls[3].options?.cwd).toBe("/work/own");
    expect(report.respawnedSessionIds).toEqual(["s-good", "s-own"]);
    expect(report.failedSessionIds).toEqual(["s-bad"]);
    expect(report.untrustedSessionIds).toEqual([]);
  });

  it("does not resume a watch owner that is still running after the stop, so no copy of it starts", () => {
    const runner = scriptedRunner(() => succeeded(""));
    const awaitedSessionIds: string[] = [];
    const report = executeReloadFanOut(
      [decision("own", ReloadAction.ResumeReconcile)],
      runner.runCommand,
      () => true,
      (sessionId) => {
        awaitedSessionIds.push(sessionId);
        return false;
      },
    );
    expect(awaitedSessionIds).toEqual(["s-own"]);
    expect(runner.calls.map((call) => call.args)).toEqual([["stop", "own"]]);
    expect(report.failedSessionIds).toEqual(["s-own"]);
  });

  it("never touches a session whose workspace refuses a background restart, probing each workspace once", () => {
    const runner = scriptedRunner(() => succeeded(""));
    const probedCwds: string[] = [];
    const report = executeReloadFanOut(
      [
        decision("a", ReloadAction.Respawn, "/locked"),
        decision("b", ReloadAction.ResumeReconcile, "/locked"),
        { ...decision("c", ReloadAction.Respawn), cwd: undefined },
      ],
      runner.runCommand,
      (cwd) => {
        probedCwds.push(cwd);
        return false;
      },
      () => true,
    );
    expect(runner.calls).toEqual([]);
    expect(probedCwds).toEqual(["/locked"]);
    expect(report.untrustedSessionIds).toEqual(["s-a", "s-b", "s-c"]);
  });
});

describe("advancePendingReload", () => {
  it("carries attempted, notified, and unrestartable sessions into the record for this install", () => {
    const report = {
      decisions: [
        { sessionId: "a", action: ReloadAction.Respawn, reason: "" },
        { sessionId: "b", action: ReloadAction.Respawn, reason: "" },
        { sessionId: "t", action: ReloadAction.NotifyManual, reason: "" },
        { sessionId: "u", action: ReloadAction.Respawn, reason: "" },
      ],
      respawnedSessionIds: ["a"],
      failedSessionIds: ["b"],
      untrustedSessionIds: ["u"],
    };
    expect(advancePendingReload(pending, report)).toEqual({
      changedAtMs: CHANGED_AT_MS,
      respawnedSessionIds: ["already", "a", "b"],
      notifiedSessionIds: ["told", "t"],
      skippedSessionIds: ["untrusted", "u"],
    });
  });
});
