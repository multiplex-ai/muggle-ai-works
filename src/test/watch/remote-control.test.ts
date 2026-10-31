import { describe, expect, it } from "vitest";
import { REMOTE_CONTROL_RESTART_COOLDOWN_MS, REMOTE_CONTROL_RESTART_WINDOW_MS } from "../../watch/constants.js";
import {
  advanceClaudeLogin,
  planRemoteControlRestarts,
  recordRemoteControlRestarts,
  remoteControlGapOf,
} from "../../watch/remote-control.js";
import {
  ClaudeProcessStatus,
  ClaudeSessionKind,
  ClaudeTurnStatus,
  ReloadAction,
  WorkSessionAgent,
  type ClaudeLoginRecord,
  type WorkSession,
} from "../../watch/types.js";

const NOW_MS = Date.parse("2026-10-31T23:00:00Z");
const LOGIN: ClaudeLoginRecord = { accountUuid: "account-b", effectiveAtMs: NOW_MS - 60 * 60_000, observedAtMs: NOW_MS };

function backgroundSession(sessionId: string, fields: Partial<WorkSession> = {}): WorkSession {
  return {
    agent: WorkSessionAgent.Claude,
    sessionId: sessionId,
    shortId: sessionId.slice(0, 8),
    name: `${sessionId} name`,
    cwd: "/repo",
    kind: ClaudeSessionKind.Background,
    turnStatus: ClaudeTurnStatus.Idle,
    processStatus: ClaudeProcessStatus.Idle,
    startedAtMs: NOW_MS - 10 * 60_000,
    pid: 100,
    ...fields,
  };
}

describe("advanceClaudeLogin", () => {
  it("records a login seen for the first time with no known start", () => {
    expect(advanceClaudeLogin(undefined, { accountUuid: "account-a", credentialsWrittenAtMs: NOW_MS - 5_000 }, NOW_MS)).toEqual({
      accountUuid: "account-a",
      observedAtMs: NOW_MS,
    });
  });

  it("keeps the start of an unchanged login and moves its last sighting", () => {
    const previous = { accountUuid: "account-a", effectiveAtMs: 1_000, observedAtMs: NOW_MS - 120_000 };
    expect(advanceClaudeLogin(previous, { accountUuid: "account-a" }, NOW_MS)).toEqual({ ...previous, observedAtMs: NOW_MS });
  });

  it("dates a change by the credentials write, inside the span since the previous tick", () => {
    const previous = { accountUuid: "account-a", observedAtMs: NOW_MS - 120_000 };
    const changed = (writtenAtMs?: number) => advanceClaudeLogin(previous, { accountUuid: "account-b", credentialsWrittenAtMs: writtenAtMs }, NOW_MS);
    expect(changed(NOW_MS - 30_000)?.effectiveAtMs).toBe(NOW_MS - 30_000);
    expect(changed(NOW_MS - 3_600_000)?.effectiveAtMs).toBe(NOW_MS - 120_000);
    expect(changed(NOW_MS + 60_000)?.effectiveAtMs).toBe(NOW_MS);
    expect(changed(undefined)?.effectiveAtMs).toBe(NOW_MS);
  });

  it("keeps the previous record when no login can be read", () => {
    const previous = { accountUuid: "account-a", observedAtMs: 1 };
    expect(advanceClaudeLogin(previous, {}, NOW_MS)).toBe(previous);
    expect(advanceClaudeLogin(undefined, {}, NOW_MS)).toBeUndefined();
  });
});

describe("remoteControlGapOf", () => {
  it("is on when linked by a process started under the current login", () => {
    expect(remoteControlGapOf(backgroundSession("on", { remoteControlSessionId: "session_1" }), LOGIN)).toBeUndefined();
  });

  it("is off with no link, or with a link a process made before the login took effect", () => {
    expect(remoteControlGapOf(backgroundSession("none"), LOGIN)).toBe("no Remote Control link");
    const linkedEarlier = backgroundSession("early", { remoteControlSessionId: "session_2", startedAtMs: NOW_MS - 2 * 60 * 60_000 });
    expect(remoteControlGapOf(linkedEarlier, LOGIN)).toBe("linked under an earlier login");
  });

  it("trusts a link when the login's start or the process start is unknown", () => {
    const linkedEarlier = backgroundSession("early", { remoteControlSessionId: "session_2", startedAtMs: 1 });
    expect(remoteControlGapOf(linkedEarlier, { accountUuid: "account-b", observedAtMs: NOW_MS })).toBeUndefined();
    expect(remoteControlGapOf(backgroundSession("unknown", { remoteControlSessionId: "session_3", startedAtMs: undefined }), LOGIN)).toBeUndefined();
  });
});

describe("planRemoteControlRestarts", () => {
  const actionsOf = (sessions: WorkSession[], restartsBySession: Record<string, string[]> = {}, maxRestarts = 3) => {
    const plan = planRemoteControlRestarts(sessions, LOGIN, restartsBySession, NOW_MS, maxRestarts);
    return { connected: plan.connectedSessionIds, actions: Object.fromEntries(plan.decisions.map((decision) => [decision.sessionId, [decision.action, decision.reason]])) };
  };

  it("restarts a session off Remote Control once its turn is over, background commands included", () => {
    const { connected, actions } = actionsOf([
      backgroundSession("linked", { remoteControlSessionId: "session_1" }),
      backgroundSession("idle-off"),
      backgroundSession("shell-off", { processStatus: ClaudeProcessStatus.Shell, turnStatus: ClaudeTurnStatus.Busy }),
      backgroundSession("old-login", { remoteControlSessionId: "session_2", startedAtMs: NOW_MS - 2 * 60 * 60_000 }),
    ]);
    expect(connected).toEqual(["linked"]);
    expect(actions).toEqual({
      "idle-off": [ReloadAction.Respawn, "no Remote Control link"],
      "shell-off": [ReloadAction.Respawn, "no Remote Control link"],
      "old-login": [ReloadAction.Respawn, "linked under an earlier login"],
    });
  });

  it("waits out a turn in flight, reading the listing when the registry has no status", () => {
    const { actions } = actionsOf([
      backgroundSession("busy", { processStatus: ClaudeProcessStatus.Busy, turnStatus: ClaudeTurnStatus.Busy }),
      backgroundSession("waiting", { processStatus: ClaudeProcessStatus.Waiting }),
      backgroundSession("old-claude-idle", { processStatus: undefined, turnStatus: ClaudeTurnStatus.Idle }),
      backgroundSession("old-claude-busy", { processStatus: undefined, turnStatus: ClaudeTurnStatus.Busy }),
    ]);
    expect(actions.busy).toEqual([ReloadAction.Defer, "no Remote Control link — turn in flight (busy)"]);
    expect(actions.waiting[0]).toBe(ReloadAction.Defer);
    expect(actions["old-claude-idle"][0]).toBe(ReloadAction.Respawn);
    expect(actions["old-claude-busy"]).toEqual([ReloadAction.Defer, "no Remote Control link — turn in flight (busy)"]);
  });

  it("names terminal sessions for /remote-control and skips what it cannot restart", () => {
    const { actions } = actionsOf([
      backgroundSession("terminal", { kind: ClaudeSessionKind.Interactive }),
      backgroundSession("no-short-id", { shortId: undefined }),
      backgroundSession("codex", { agent: WorkSessionAgent.Codex }),
      backgroundSession("stopped", { pid: undefined, turnStatus: undefined }),
    ]);
    expect(actions.terminal).toEqual([ReloadAction.NotifyManual, "no Remote Control link — terminal session, run /remote-control in it"]);
    expect(actions["no-short-id"][0]).toBe(ReloadAction.Skip);
    expect(actions.codex).toBeUndefined();
    expect(actions.stopped).toBeUndefined();
  });

  it("gives a restart time to link and stops after two in a day", () => {
    const recent = new Date(NOW_MS - REMOTE_CONTROL_RESTART_COOLDOWN_MS / 2).toISOString();
    const earlier = new Date(NOW_MS - 2 * REMOTE_CONTROL_RESTART_COOLDOWN_MS).toISOString();
    const yesterday = new Date(NOW_MS - REMOTE_CONTROL_RESTART_WINDOW_MS - 1).toISOString();
    const { actions } = actionsOf([backgroundSession("cooling"), backgroundSession("spent"), backgroundSession("aged")], {
      cooling: [recent],
      spent: [earlier, earlier],
      aged: [yesterday, yesterday],
    });
    expect(actions.cooling).toEqual([ReloadAction.Skip, "no Remote Control link — restarted recently, waiting for it to link"]);
    expect(actions.spent).toEqual([ReloadAction.Skip, "no Remote Control link after 2 restarts today"]);
    expect(actions.aged[0]).toBe(ReloadAction.Respawn);
  });

  it("restarts no more than the pass may", () => {
    const { actions } = actionsOf([backgroundSession("first"), backgroundSession("second")], {}, 1);
    expect(actions.first[0]).toBe(ReloadAction.Respawn);
    expect(actions.second).toEqual([ReloadAction.Defer, "no Remote Control link — restart cap reached this pass"]);
  });
});

describe("recordRemoteControlRestarts", () => {
  it("adds every attempted restart and drops ones outside the window", () => {
    const old = new Date(NOW_MS - REMOTE_CONTROL_RESTART_WINDOW_MS - 1).toISOString();
    const kept = new Date(NOW_MS - 60_000).toISOString();
    const recorded = recordRemoteControlRestarts(
      { stale: [old], kept: [old, kept] },
      { decisions: [], respawnedSessionIds: ["kept", "new"], failedSessionIds: ["failed"], untrustedSessionIds: ["refused"] },
      NOW_MS,
    );
    const nowIso = new Date(NOW_MS).toISOString();
    expect(recorded).toEqual({ kept: [kept, nowIso], new: [nowIso], failed: [nowIso], refused: [nowIso] });
  });
});
