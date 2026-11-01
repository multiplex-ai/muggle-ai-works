import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { LIMIT_RESUME_PROMPT, LIMIT_STOP_MAX_AGE_MS } from "../../watch/constants.js";
import { executeLimitResumes, planLimitResumes } from "../../watch/limit-resume.js";
import {
  ClaudeSessionKind,
  ClaudeTurnStatus,
  LimitResumeAction,
  WatcherRecoveryOutcome,
  WatchEventKind,
  WorkSessionAgent,
  type CommandRunner,
  type LimitResumeAttempt,
  type LimitResumeDecision,
  type LimitStop,
  type RecoveryExecutionDeps,
  type WorkSession,
} from "../../watch/types.js";
import { makeTempDir, scriptedRunner, succeeded } from "./fixtures.js";

const NOW_MS = Date.parse("2026-11-01T12:00:00Z");
const HOUR_MS = 3_600_000;

function backgroundSession(sessionId: string, overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    agent: WorkSessionAgent.Claude,
    sessionId: sessionId,
    shortId: sessionId.slice(0, 8),
    kind: ClaudeSessionKind.Background,
    ...overrides,
  };
}

function stopOf(sessionId: string, overrides: Partial<LimitStop> = {}): LimitStop {
  return { noticeUuid: `notice-${sessionId}`, noticedAtMs: NOW_MS - 3 * HOUR_MS, resetsAtMs: NOW_MS - HOUR_MS, ...overrides };
}

function plan(
  sessions: WorkSession[],
  overrides: { attempts?: Record<string, LimitResumeAttempt[]>; isUsageLimitInForce?: boolean; maxContinues?: number; stops?: LimitStop[] } = {},
): LimitResumeDecision[] {
  const stops = new Map(sessions.map((session, index) => [session.sessionId, overrides.stops?.[index] ?? stopOf(session.sessionId)]));
  return planLimitResumes(sessions, stops, overrides.attempts ?? {}, NOW_MS, overrides.isUsageLimitInForce ?? false, overrides.maxContinues ?? 2);
}

describe("planLimitResumes", () => {
  it("continues a stopped background session whose limit reset, stopping it first only when it still runs", () => {
    const decisions = plan([backgroundSession("endedaaa"), backgroundSession("runningbb", { pid: 9, turnStatus: ClaudeTurnStatus.Idle })]);
    expect(decisions.map((decision) => [decision.sessionId, decision.action, decision.runningShortId])).toEqual([
      ["endedaaa", LimitResumeAction.Continue, undefined],
      ["runningbb", LimitResumeAction.Continue, "runningb"],
    ]);
    expect(decisions[0].reason).toBe(`limit reset at ${new Date(NOW_MS - HOUR_MS).toISOString()}`);
  });

  it("waits for the notice's reset, the account's usage window and the tick cap", () => {
    const resetLater = plan([backgroundSession("later-aa")], { stops: [stopOf("later-aa", { resetsAtMs: NOW_MS + HOUR_MS })] });
    expect(resetLater[0]).toMatchObject({ action: LimitResumeAction.Wait, reason: `limit resets at ${new Date(NOW_MS + HOUR_MS).toISOString()}` });
    expect(plan([backgroundSession("held-aa")], { isUsageLimitInForce: true })[0]).toMatchObject({ action: LimitResumeAction.Wait, reason: "the account is still at a usage limit" });
    const capped = plan([backgroundSession("first-aa"), backgroundSession("second-b")], { maxContinues: 1 });
    expect(capped.map((decision) => decision.action)).toEqual([LimitResumeAction.Continue, LimitResumeAction.Wait]);
  });

  it("skips terminal sessions, turns in flight and a session that used today's tries", () => {
    const tries = [1, 2].map((hour) => ({ noticeUuid: "notice-tried-aa", at: new Date(NOW_MS - hour * HOUR_MS).toISOString(), isContinued: false }));
    const decisions = plan(
      [
        backgroundSession("terminal", { kind: ClaudeSessionKind.Interactive }),
        backgroundSession("busy-aaa", { pid: 9, turnStatus: ClaudeTurnStatus.Busy }),
        backgroundSession("tried-aa"),
      ],
      { attempts: { "tried-aa": tries } },
    );
    expect(decisions.map((decision) => [decision.action, decision.reason])).toEqual([
      [LimitResumeAction.Skip, "terminal session, continue it there"],
      [LimitResumeAction.Skip, "turn in flight (busy)"],
      [LimitResumeAction.Skip, "after 2 tries today"],
    ]);
  });

  it("says nothing about a notice already continued, one too old to pick up, or a session that did not stop on a limit", () => {
    const continued = { "done-aaa": [{ noticeUuid: "notice-done-aaa", at: new Date(NOW_MS - HOUR_MS).toISOString(), isContinued: true }] };
    expect(plan([backgroundSession("done-aaa")], { attempts: continued })).toEqual([]);
    expect(plan([backgroundSession("old-aaaa")], { stops: [stopOf("old-aaaa", { noticedAtMs: NOW_MS - LIMIT_STOP_MAX_AGE_MS - 1 })] })).toEqual([]);
    expect(planLimitResumes([backgroundSession("plain-aa")], new Map(), {}, NOW_MS, false, 2)).toEqual([]);
  });
});

describe("executeLimitResumes", () => {
  function projectsWithTranscript(sessionId: string, cwd: string): string {
    const projectsDir = makeTempDir("projects");
    mkdirSync(join(projectsDir, "proj"));
    writeFileSync(join(projectsDir, "proj", `${sessionId}.jsonl`), `${JSON.stringify({ cwd: cwd })}\n`);
    return projectsDir;
  }

  function deps(runCommand: CommandRunner, claudeProjectsDir: string, overrides: Partial<RecoveryExecutionDeps> = {}): RecoveryExecutionDeps {
    return {
      runCommand: runCommand,
      claudeProjectsDir: claudeProjectsDir,
      nowMs: NOW_MS,
      canRestartIn: () => true,
      waitForExit: () => true,
      isSessionRunning: () => false,
      ...overrides,
    };
  }

  const continueDecision = (sessionId: string, overrides: Partial<LimitResumeDecision> = {}): LimitResumeDecision => ({
    sessionId: sessionId,
    shortId: sessionId.slice(0, 8),
    action: LimitResumeAction.Continue,
    reason: "limit reset at 2026-11-01T11:00:00.000Z",
    noticeUuid: `notice-${sessionId}`,
    ...overrides,
  });

  it("resumes the session in place on the continue prompt and records the notice as continued", () => {
    const projectCwd = makeTempDir("project");
    const runner = scriptedRunner(() => succeeded("backgrounded · endedaaa\n"));
    const executed = executeLimitResumes(
      [continueDecision("endedaaa"), { ...continueDecision("waiting"), action: LimitResumeAction.Wait }],
      { stale: [{ noticeUuid: "n", at: new Date(NOW_MS - LIMIT_STOP_MAX_AGE_MS - 1).toISOString(), isContinued: true }] },
      deps(runner.runCommand, projectsWithTranscript("endedaaa", projectCwd)),
    );
    expect(runner.calls).toEqual([
      { executable: "claude", args: ["--resume", "endedaaa", "--bg", LIMIT_RESUME_PROMPT], options: { cwd: projectCwd, isStderrCaptured: true } },
    ]);
    expect(executed.decisions.map((decision) => decision.outcome)).toEqual([WatcherRecoveryOutcome.Resumed, undefined]);
    expect(executed.attemptsBySession).toEqual({
      "endedaaa": [{ noticeUuid: "notice-endedaaa", at: new Date(NOW_MS).toISOString(), isContinued: true }],
    });
    expect(executed.events).toEqual([
      {
        at: new Date(NOW_MS).toISOString(),
        kind: WatchEventKind.Resumed,
        subject: "session endedaaa",
        message: "continued it after its usage limit reset (limit reset at 2026-11-01T11:00:00.000Z)",
      },
    ]);
  });

  it("stops a running session first, and leaves it where Claude would not resume it", () => {
    const projectCwd = makeTempDir("project");
    const runner = scriptedRunner(() => succeeded("ok"));
    const resumed = executeLimitResumes(
      [continueDecision("runningbb", { runningShortId: "runningb" })],
      {},
      deps(runner.runCommand, projectsWithTranscript("runningbb", projectCwd)),
    );
    expect(runner.calls.map((call) => call.args[0])).toEqual(["stop", "--resume"]);
    expect(resumed.decisions[0].outcome).toBe(WatcherRecoveryOutcome.Resumed);

    const refusingRunner = scriptedRunner(() => succeeded("ok"));
    const refused = executeLimitResumes(
      [continueDecision("runningbb", { runningShortId: "runningb" })],
      {},
      deps(refusingRunner.runCommand, projectsWithTranscript("runningbb", projectCwd), { canRestartIn: () => false }),
    );
    expect(refusingRunner.calls).toEqual([]);
    expect(refused.decisions[0].outcome).toBe(WatcherRecoveryOutcome.RestartRefused);
    expect(refused.events[0].kind).toBe(WatchEventKind.RestartRefused);
    expect(refused.attemptsBySession["runningbb"]).toEqual([{ noticeUuid: "notice-runningbb", at: new Date(NOW_MS).toISOString(), isContinued: false }]);
  });

  it("removes a copy Claude starts instead and leaves the notice open for a later try", () => {
    const runner = scriptedRunner((executable, args) => (args[0] === "--resume" ? succeeded("backgrounded · c0ffee12\n") : succeeded("ok")));
    const executed = executeLimitResumes([continueDecision("endedaaa")], {}, deps(runner.runCommand, projectsWithTranscript("endedaaa", makeTempDir("project"))));
    expect(runner.calls.map((call) => call.args.slice(0, 2))).toEqual([["--resume", "endedaaa"], ["stop", "c0ffee12"], ["rm", "c0ffee12"]]);
    expect(executed.decisions[0].outcome).toBe(WatcherRecoveryOutcome.ResumeForked);
    expect(executed.events[0]).toMatchObject({ kind: WatchEventKind.ResumeForked, message: "could not continue it: Claude started copy c0ffee12 instead; stopped and removed the copy" });
    expect(executed.attemptsBySession["endedaaa"][0].isContinued).toBe(false);
  });

  it("does not run anything without the session's transcript", () => {
    const runner = scriptedRunner(() => succeeded("ok"));
    const executed = executeLimitResumes([continueDecision("gone-aaa")], {}, deps(runner.runCommand, makeTempDir("projects")));
    expect(runner.calls).toEqual([]);
    expect(executed.decisions[0].outcome).toBe(WatcherRecoveryOutcome.TranscriptMissing);
  });
});
