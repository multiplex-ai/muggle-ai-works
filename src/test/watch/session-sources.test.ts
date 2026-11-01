import { mkdirSync, utimesSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { isSessionRunning, readClaudeSessions, waitForSessionExit } from "../../watch/claude-sessions.js";
import { SESSION_EXIT_POLL_MS, SESSION_EXIT_WAIT_MS } from "../../watch/constants.js";
import { findClaudeSessionCwd } from "../../watch/claude-transcripts.js";
import { readCodexSessions } from "../../watch/codex-sessions.js";
import { cwdFromSessionHead, enumValueOf, optionalString, readFileHead } from "../../watch/field-parsers.js";
import { hasLiveProcess, isIdleBackgroundSession } from "../../watch/session-liveness.js";
import { ClaudeJobState, ClaudeProcessStatus, ClaudeSessionKind, ClaudeTurnStatus, WorkSessionAgent, type WorkSession } from "../../watch/types.js";
import { makeTempDir, scriptedRunner, succeeded } from "./fixtures.js";

describe("readClaudeSessions", () => {
  it("lists active sessions and joins each one's pid from the registry", () => {
    const registryDir = makeTempDir("claude-registry");
    writeFileSync(join(registryDir, "4120.json"), JSON.stringify({ pid: 4120, sessionId: "aaaa1111-0000" }));
    writeFileSync(join(registryDir, "broken.json"), "{");
    writeFileSync(join(registryDir, "4120.key"), "secret");
    const listing = [
      { id: "aaaa1111", sessionId: "aaaa1111-0000", kind: "background", status: "idle", state: "blocked", name: "fix", cwd: "C:\\r", startedAt: 5 },
      { id: "bbbb2222", sessionId: "bbbb2222-0000", kind: "interactive", status: "mystery" },
      { id: "no-session-id" },
    ];
    const runner = scriptedRunner(() => succeeded(JSON.stringify(listing)));
    const sessions = readClaudeSessions(runner.runCommand, registryDir);
    expect(runner.calls[0]).toMatchObject({ executable: "claude", args: ["agents", "--json"] });
    expect(sessions).toEqual([
      {
        agent: WorkSessionAgent.Claude,
        sessionId: "aaaa1111-0000",
        shortId: "aaaa1111",
        name: "fix",
        cwd: "C:\\r",
        kind: ClaudeSessionKind.Background,
        turnStatus: ClaudeTurnStatus.Idle,
        jobState: ClaudeJobState.Blocked,
        startedAtMs: 5,
        pid: 4120,
      },
      expect.objectContaining({ sessionId: "bbbb2222-0000", kind: ClaudeSessionKind.Interactive, turnStatus: undefined, pid: undefined }),
    ]);
  });

  it("joins the process's own status and Remote Control link from the registry", () => {
    const registryDir = makeTempDir("claude-registry");
    writeFileSync(join(registryDir, "4120.json"), JSON.stringify({ pid: 4120, sessionId: "linked-0000", status: "shell", bridgeSessionId: "session_01ABC" }));
    writeFileSync(join(registryDir, "4121.json"), JSON.stringify({ pid: 4121, sessionId: "unlinked-0000", status: "napping", bridgeSessionId: null }));
    const listing = [
      { id: "linked00", sessionId: "linked-0000", status: "busy" },
      { id: "unlinked", sessionId: "unlinked-0000", status: "idle" },
    ];
    const sessions = readClaudeSessions(scriptedRunner(() => succeeded(JSON.stringify(listing))).runCommand, registryDir);
    expect(sessions?.[0]).toMatchObject({ turnStatus: ClaudeTurnStatus.Busy, processStatus: ClaudeProcessStatus.Shell, remoteControlSessionId: "session_01ABC" });
    expect(sessions?.[1]).toMatchObject({ pid: 4121, processStatus: undefined, remoteControlSessionId: undefined });
  });

  it("takes the pid the listing reports over the registry's", () => {
    const registryDir = makeTempDir("claude-registry");
    writeFileSync(join(registryDir, "4120.json"), JSON.stringify({ pid: 4120, sessionId: "aaaa1111-0000" }));
    const listing = [{ id: "aaaa1111", sessionId: "aaaa1111-0000", status: "idle", pid: 5150 }];
    const sessions = readClaudeSessions(scriptedRunner(() => succeeded(JSON.stringify(listing))).runCommand, registryDir);
    expect(sessions?.[0].pid).toBe(5150);
  });

  it("returns null when the listing cannot be read, so unknown is not mistaken for none", () => {
    const missingRegistry = join(makeTempDir("claude-registry"), "absent");
    expect(readClaudeSessions(scriptedRunner(() => null).runCommand, missingRegistry)).toBeNull();
    expect(readClaudeSessions(scriptedRunner(() => ({ exitCode: 1, stdout: "[]" })).runCommand, missingRegistry)).toBeNull();
    expect(readClaudeSessions(scriptedRunner(() => succeeded("{}")).runCommand, missingRegistry)).toBeNull();
    expect(readClaudeSessions(scriptedRunner(() => succeeded("nope")).runCommand, missingRegistry)).toBeNull();
    expect(readClaudeSessions(scriptedRunner(() => succeeded("[]")).runCommand, missingRegistry)).toEqual([]);
  });
});

describe("readCodexSessions", () => {
  const NOW_MS = Date.parse("2026-10-24T12:00:00Z");

  function writeRollout(sessionsDir: string, dayPath: string, sessionId: string, ageMs: number, head: string): void {
    const dayDir = join(sessionsDir, ...dayPath.split("/"));
    mkdirSync(dayDir, { recursive: true });
    const rolloutPath = join(dayDir, `rollout-2026-10-24T11-00-00-${sessionId}.jsonl`);
    writeFileSync(rolloutPath, head);
    utimesSync(rolloutPath, (NOW_MS - ageMs) / 1000, (NOW_MS - ageMs) / 1000);
  }

  it("reports rollouts written inside the active window, across recent day dirs", () => {
    const sessionsDir = makeTempDir("codex-sessions");
    const activeId = "11111111-2222-3333-4444-555555555555";
    const staleId = "66666666-7777-8888-9999-000000000000";
    const olderDayId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    writeRollout(sessionsDir, "2026/10/24", activeId, 60_000, '{"type":"session_meta","payload":{"cwd":"C:\\\\repo"}}\n');
    writeRollout(sessionsDir, "2026/10/24", staleId, 3_600_000, "{}\n");
    writeRollout(sessionsDir, "2026/10/20", olderDayId, 120_000, "{}\n");
    writeFileSync(join(sessionsDir, "2026", "10", "24", "rollout-without-id.jsonl"), "{}");
    writeFileSync(join(sessionsDir, "2026", "10", "24", "notes.txt"), "{}");
    const sessions = readCodexSessions(sessionsDir, NOW_MS);
    expect(sessions.map((session) => session.sessionId).sort()).toEqual([activeId, olderDayId].sort());
    expect(sessions.find((session) => session.sessionId === activeId)).toMatchObject({ agent: WorkSessionAgent.Codex, cwd: "C:\\repo" });
  });

  it("yields nothing when Codex has never run", () => {
    expect(readCodexSessions(join(makeTempDir("codex"), "absent"), NOW_MS)).toEqual([]);
  });
});

describe("findClaudeSessionCwd", () => {
  it("reads the cwd from the session's transcript in whichever project holds it", () => {
    const projectsDir = makeTempDir("claude-projects");
    mkdirSync(join(projectsDir, "C--other"));
    mkdirSync(join(projectsDir, "C--repo"));
    writeFileSync(join(projectsDir, "C--repo", "sess-1.jsonl"), '{"type":"user","cwd":"C:\\\\repo\\\\wt"}\n');
    expect(findClaudeSessionCwd(projectsDir, "sess-1")).toBe("C:\\repo\\wt");
    expect(findClaudeSessionCwd(projectsDir, "sess-2")).toBeUndefined();
    expect(findClaudeSessionCwd(join(projectsDir, "absent"), "sess-1")).toBeUndefined();
  });
});

describe("waitForSessionExit", () => {
  const registryDir = (): string => join(makeTempDir("claude-registry"), "absent");

  it("returns once the listing shows the session without a process, polling meanwhile", () => {
    const listings = [
      [{ id: "s1", sessionId: "s1-full", status: "idle", pid: 7 }],
      [{ id: "s1", sessionId: "s1-full", status: "idle", pid: 7 }],
      [{ id: "s1", sessionId: "s1-full", state: "done" }],
    ];
    let listingIndex = 0;
    const runner = scriptedRunner(() => succeeded(JSON.stringify(listings[Math.min(listingIndex++, listings.length - 1)])));
    const naps: number[] = [];
    expect(waitForSessionExit(runner.runCommand, registryDir(), "s1-full", (durationMs) => naps.push(durationMs))).toBe(true);
    expect(naps).toEqual([SESSION_EXIT_POLL_MS, SESSION_EXIT_POLL_MS]);
  });

  it("gives up after the wait while the process lives, and never trusts an unreadable listing", () => {
    const naps: number[] = [];
    const running = scriptedRunner(() => succeeded(JSON.stringify([{ id: "s1", sessionId: "s1-full", status: "idle" }])));
    expect(waitForSessionExit(running.runCommand, registryDir(), "s1-full", (durationMs) => naps.push(durationMs))).toBe(false);
    expect(naps.reduce((total, durationMs) => total + durationMs, 0)).toBe(SESSION_EXIT_WAIT_MS);
    expect(waitForSessionExit(scriptedRunner(() => null).runCommand, registryDir(), "s1-full", () => undefined)).toBe(false);
    expect(waitForSessionExit(scriptedRunner(() => succeeded("[]")).runCommand, registryDir(), "s1-full", () => undefined)).toBe(true);
  });

  it("keeps waiting while Claude's registry still runs the session the listing has dropped", () => {
    const liveRegistryDir = makeTempDir("claude-registry");
    writeFileSync(join(liveRegistryDir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: "s1-full" }));
    expect(waitForSessionExit(scriptedRunner(() => succeeded("[]")).runCommand, liveRegistryDir, "s1-full", () => undefined)).toBe(false);
  });
});

describe("isSessionRunning", () => {
  const DEAD_PID = 2 ** 30;

  it("counts a live registry process even when the listing leaves the session out", () => {
    const registryDir = makeTempDir("claude-registry");
    writeFileSync(join(registryDir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: "s1-full" }));
    const runner = scriptedRunner(() => succeeded("[]"));
    expect(isSessionRunning(runner.runCommand, registryDir, "s1-full")).toBe(true);
    expect(runner.calls).toEqual([]);
  });

  it("falls back to the listing when the registry's process is gone, and is unknown when the listing cannot be read", () => {
    const registryDir = makeTempDir("claude-registry");
    writeFileSync(join(registryDir, `${DEAD_PID}.json`), JSON.stringify({ pid: DEAD_PID, sessionId: "s1-full" }));
    expect(isSessionRunning(scriptedRunner(() => succeeded("[]")).runCommand, registryDir, "s1-full")).toBe(false);
    const listedIdle = JSON.stringify([{ id: "s1", sessionId: "s1-full", status: "idle" }]);
    expect(isSessionRunning(scriptedRunner(() => succeeded(listedIdle)).runCommand, registryDir, "s1-full")).toBe(true);
    expect(isSessionRunning(scriptedRunner(() => null).runCommand, registryDir, "s1-full")).toBeNull();
  });
});

describe("session liveness", () => {
  const session = (overrides: Partial<WorkSession>): WorkSession => ({
    agent: WorkSessionAgent.Claude,
    sessionId: "s1",
    shortId: "s1short",
    kind: ClaudeSessionKind.Background,
    turnStatus: ClaudeTurnStatus.Idle,
    pid: 10,
    ...overrides,
  });

  it("calls a listed Claude session with neither pid nor turn status ended", () => {
    expect(hasLiveProcess(session({}))).toBe(true);
    expect(hasLiveProcess(session({ pid: undefined }))).toBe(true);
    expect(hasLiveProcess(session({ pid: undefined, turnStatus: undefined }))).toBe(false);
    expect(hasLiveProcess({ agent: WorkSessionAgent.Codex, sessionId: "c1" })).toBe(true);
  });

  it("restarts only a running background session between turns", () => {
    expect(isIdleBackgroundSession(session({}))).toBe(true);
    expect(isIdleBackgroundSession(session({ turnStatus: ClaudeTurnStatus.Busy }))).toBe(false);
    expect(isIdleBackgroundSession(session({ kind: ClaudeSessionKind.Interactive }))).toBe(false);
    expect(isIdleBackgroundSession(session({ shortId: undefined }))).toBe(false);
    expect(isIdleBackgroundSession(session({ pid: undefined, turnStatus: undefined }))).toBe(false);
  });
});

describe("field parsers", () => {
  it("matches enum members exactly and rejects everything else", () => {
    expect(enumValueOf(ClaudeTurnStatus, "busy")).toBe(ClaudeTurnStatus.Busy);
    expect(enumValueOf(ClaudeTurnStatus, "BUSY")).toBeUndefined();
    expect(enumValueOf(ClaudeTurnStatus, 3)).toBeUndefined();
  });

  it("keeps only non-empty strings", () => {
    expect(optionalString("x")).toBe("x");
    expect(optionalString("")).toBeUndefined();
    expect(optionalString(7)).toBeUndefined();
  });

  it("reads a file head, or undefined for a missing file", () => {
    const dir = makeTempDir("file-head");
    writeFileSync(join(dir, "a.jsonl"), "first\nsecond\n");
    expect(readFileHead(join(dir, "a.jsonl"))).toBe("first\nsecond\n");
    expect(readFileHead(join(dir, "missing.jsonl"))).toBeUndefined();
  });

  it("decodes the first cwd field and ignores malformed ones", () => {
    expect(cwdFromSessionHead('{"cwd": "C:\\\\a \\"b\\""}')).toBe('C:\\a "b"');
    expect(cwdFromSessionHead('{"cwd":""}')).toBeUndefined();
    expect(cwdFromSessionHead('{"cwd":"bad \\x escape"}')).toBeUndefined();
    expect(cwdFromSessionHead("{}")).toBeUndefined();
  });
});
