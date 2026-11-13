import { describe, expect, it } from "vitest";
import { MCP_CONNECT_GRACE_MS, MCP_MISSING_CONFIRM_MS, MCP_RECOVER_RESTART_WINDOW_MS } from "../../watch/constants.js";
import { planMcpRecoverRestarts } from "../../watch/mcp-recover.js";
import {
  ClaudeProcessStatus,
  ClaudeSessionKind,
  ClaudeTurnStatus,
  ReloadAction,
  WorkSessionAgent,
  type WorkSession,
} from "../../watch/types.js";

const NOW_MS = Date.parse("2026-11-13T07:30:00Z");
const CONFIRMED_MISSING_SINCE = new Date(NOW_MS - MCP_MISSING_CONFIRM_MS).toISOString();

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
    pid: 100,
    loadedAtMs: NOW_MS - 5 * 60 * 60_000,
    hasMuggleMcpServer: false,
    ...fields,
  };
}

describe("planMcpRecoverRestarts", () => {
  const planOf = (
    sessions: WorkSession[],
    options: { missingSince?: Record<string, string>; restarts?: Record<string, string[]>; listed?: (sessionId: string) => boolean; maxRestarts?: number } = {},
  ) => {
    const missingSince = options.missingSince ?? Object.fromEntries(sessions.map((session) => [session.sessionId, CONFIRMED_MISSING_SINCE]));
    const plan = planMcpRecoverRestarts(sessions, options.listed ?? (() => true), missingSince, options.restarts ?? {}, NOW_MS, options.maxRestarts ?? 3);
    return {
      connected: plan.connectedSessionIds,
      missingSince: plan.missingSinceBySession,
      actions: Object.fromEntries(plan.decisions.map((decision) => [decision.sessionId, [decision.action, decision.reason]])),
    };
  };

  it("restarts an idle session whose server stayed missing across the confirm window, and counts the rest connected", () => {
    const { connected, actions } = planOf([
      backgroundSession("connected", { hasMuggleMcpServer: true }),
      backgroundSession("lost"),
      backgroundSession("lost-shell", { processStatus: ClaudeProcessStatus.Shell, turnStatus: ClaudeTurnStatus.Busy }),
    ]);
    expect(connected).toEqual(["connected"]);
    expect(actions).toEqual({
      lost: [ReloadAction.Respawn, "no Muggle MCP server"],
      "lost-shell": [ReloadAction.Respawn, "no Muggle MCP server"],
    });
  });

  it("waits a tick on a first sighting, and starts the record then", () => {
    const { actions, missingSince } = planOf([backgroundSession("first-seen")], { missingSince: {} });
    expect(actions["first-seen"]).toEqual([ReloadAction.Defer, "no Muggle MCP server — confirming on the next tick"]);
    expect(missingSince).toEqual({ "first-seen": new Date(NOW_MS).toISOString() });
  });

  it("keeps the first sighting and drops sessions that have their server again", () => {
    const { missingSince } = planOf([backgroundSession("still-lost"), backgroundSession("back", { hasMuggleMcpServer: true })], {
      missingSince: { "still-lost": CONFIRMED_MISSING_SINCE, back: CONFIRMED_MISSING_SINCE, ended: CONFIRMED_MISSING_SINCE },
    });
    expect(missingSince).toEqual({ "still-lost": CONFIRMED_MISSING_SINCE });
  });

  it("leaves alone a session still starting, one whose transcript never lists the server, and one the table could not place", () => {
    const listed = (sessionId: string) => sessionId !== "unlisted";
    const { connected, actions, missingSince } = planOf(
      [
        backgroundSession("starting", { loadedAtMs: NOW_MS - MCP_CONNECT_GRACE_MS + 1 }),
        backgroundSession("unstamped-start", { loadedAtMs: undefined }),
        backgroundSession("unlisted"),
        backgroundSession("unplaced", { hasMuggleMcpServer: undefined }),
        backgroundSession("codex", { agent: WorkSessionAgent.Codex }),
        backgroundSession("ended", { pid: undefined, turnStatus: undefined }),
      ],
      { listed: listed },
    );
    expect(connected).toEqual([]);
    expect(actions).toEqual({});
    expect(missingSince).toEqual({});
  });

  it("waits out a turn in flight and restarts no more than the pass may", () => {
    const { actions } = planOf(
      [
        backgroundSession("busy", { processStatus: ClaudeProcessStatus.Busy, turnStatus: ClaudeTurnStatus.Busy }),
        backgroundSession("first"),
        backgroundSession("second"),
      ],
      { maxRestarts: 1 },
    );
    expect(actions.busy).toEqual([ReloadAction.Defer, "no Muggle MCP server — turn in flight (busy)"]);
    expect(actions.first[0]).toBe(ReloadAction.Respawn);
    expect(actions.second).toEqual([ReloadAction.Defer, "no Muggle MCP server — restart cap reached this pass"]);
  });

  it("names terminal sessions for /mcp, skips what it cannot restart, and stops after two restarts in a day", () => {
    const earlier = new Date(NOW_MS - 60 * 60_000).toISOString();
    const yesterday = new Date(NOW_MS - MCP_RECOVER_RESTART_WINDOW_MS - 1).toISOString();
    const { actions } = planOf(
      [
        backgroundSession("terminal", { kind: ClaudeSessionKind.Interactive }),
        backgroundSession("no-short-id", { shortId: undefined }),
        backgroundSession("spent"),
        backgroundSession("aged"),
      ],
      { restarts: { spent: [earlier, earlier], aged: [yesterday, yesterday] } },
    );
    expect(actions.terminal).toEqual([ReloadAction.NotifyManual, "no Muggle MCP server — terminal session, run /mcp in it"]);
    expect(actions["no-short-id"][0]).toBe(ReloadAction.Skip);
    expect(actions.spent).toEqual([ReloadAction.Skip, "no Muggle MCP server after 2 restarts today — run /mcp in it"]);
    expect(actions.aged[0]).toBe(ReloadAction.Respawn);
  });

  it("asks the transcript only about sessions missing their server", () => {
    const asked: string[] = [];
    planOf([backgroundSession("connected", { hasMuggleMcpServer: true }), backgroundSession("lost")], {
      listed: (sessionId) => {
        asked.push(sessionId);
        return true;
      },
    });
    expect(asked).toEqual(["lost"]);
  });
});
