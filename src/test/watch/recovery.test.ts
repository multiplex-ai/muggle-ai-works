import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { ProviderPrState } from "../../guardrails/types.js";
import { executeWatcherRecoveries, isRecoverable, planWatcherRecoveries } from "../../watch/recovery.js";
import {
  ClaudeSessionKind,
  ClaudeTurnStatus,
  WatcherLiveness,
  WatcherRecoveryOutcome,
  WatchEventKind,
  WorkSessionAgent,
  type CommandRunner,
  type RecoveryExecutionDeps,
  type WatchSlotAssessment,
  type WorkSession,
} from "../../watch/types.js";
import { makeTempDir, scriptedRunner, succeeded } from "./fixtures.js";

const NOW_MS = Date.parse("2026-10-24T12:00:00Z");
const MINUTE_MS = 60_000;

function deadSlot(slug: string, ownerSessionId: string, overrides: Partial<WatchSlotAssessment> = {}): WatchSlotAssessment {
  return {
    slug: slug,
    slotDir: `/s/${slug}`,
    pr: { repo: "o/r", number: 1, url: `u-${slug}` },
    isRegistered: true,
    watcher: WatcherLiveness.Dead,
    ownerSessionId: ownerSessionId,
    isOwnerSessionActive: false,
    live: { url: `u-${slug}`, state: ProviderPrState.Open, unresolvedThreadCount: 0 },
    ...overrides,
  };
}

const minutesAgo = (minutes: number): string => new Date(NOW_MS - minutes * MINUTE_MS).toISOString();

function liveOwner(sessionId: string, overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    agent: WorkSessionAgent.Claude,
    sessionId: sessionId,
    shortId: `${sessionId}-short`,
    kind: ClaudeSessionKind.Background,
    turnStatus: ClaudeTurnStatus.Idle,
    pid: 10,
    ...overrides,
  };
}

function executionDeps(
  runCommand: CommandRunner,
  claudeProjectsDir: string,
  overrides: Partial<RecoveryExecutionDeps> = {},
): RecoveryExecutionDeps {
  return {
    runCommand: runCommand,
    claudeProjectsDir: claudeProjectsDir,
    nowMs: NOW_MS,
    canRestartIn: () => true,
    waitForExit: () => true,
    ...overrides,
  };
}

describe("isRecoverable", () => {
  it("accepts only a registered, confirmed-open slot whose watcher and owner are both gone", () => {
    expect(isRecoverable(deadSlot("a", "o1"))).toBe(true);
    expect(isRecoverable(deadSlot("a", "o1", { isRegistered: false }))).toBe(false);
    expect(isRecoverable(deadSlot("a", "o1", { watcher: WatcherLiveness.Deaf }))).toBe(false);
    expect(isRecoverable(deadSlot("a", "o1", { watcher: WatcherLiveness.Rearming }))).toBe(false);
    expect(isRecoverable(deadSlot("a", "o1", { live: undefined }))).toBe(false);
    expect(isRecoverable(deadSlot("a", "o1", { live: { url: "u", state: ProviderPrState.Merged, unresolvedThreadCount: 0 } }))).toBe(false);
    expect(isRecoverable(deadSlot("a", "o1", { isOwnerSessionActive: true }))).toBe(false);
    expect(isRecoverable(deadSlot("a", "o1", { isOwnerSessionActive: undefined }))).toBe(false);
    expect(isRecoverable(deadSlot("a", "o1", { ownerSessionId: undefined }))).toBe(false);
  });

  it("accepts a running owner only while it sits idle in the background", () => {
    const running = deadSlot("a", "o1", { isOwnerSessionActive: true });
    expect(isRecoverable(running, liveOwner("o1"))).toBe(true);
    expect(isRecoverable(running, liveOwner("o1", { turnStatus: ClaudeTurnStatus.Busy }))).toBe(false);
    expect(isRecoverable(running, liveOwner("o1", { turnStatus: ClaudeTurnStatus.Waiting }))).toBe(false);
    expect(isRecoverable(running, liveOwner("o1", { kind: ClaudeSessionKind.Interactive }))).toBe(false);
    expect(isRecoverable(running)).toBe(false);
  });
});

describe("planWatcherRecoveries", () => {
  it("plans one resume per owner covering all of its slots", () => {
    const planned = planWatcherRecoveries([deadSlot("b", "o1"), deadSlot("a", "o1"), deadSlot("c", "o2"), deadSlot("a", "o1")], {}, NOW_MS, false);
    expect(planned).toEqual([
      { ownerSessionId: "o1", slotSlugs: ["a", "b"], outcome: WatcherRecoveryOutcome.ResumeDue },
      { ownerSessionId: "o2", slotSlugs: ["c"], outcome: WatcherRecoveryOutcome.ResumeDue },
    ]);
  });

  it("holds an owner inside its cooldown and stops after the attempt cap", () => {
    const planned = planWatcherRecoveries(
      [deadSlot("a", "cooling"), deadSlot("b", "exhausted"), deadSlot("c", "aged-out")],
      {
        cooling: [minutesAgo(10)],
        exhausted: [minutesAgo(300), minutesAgo(200), minutesAgo(100)],
        "aged-out": [minutesAgo(25 * 60), minutesAgo(26 * 60), minutesAgo(27 * 60), "garbage"],
      },
      NOW_MS,
      false,
    );
    expect(Object.fromEntries(planned.map((recovery) => [recovery.ownerSessionId, recovery.outcome]))).toEqual({
      cooling: WatcherRecoveryOutcome.CoolingDown,
      exhausted: WatcherRecoveryOutcome.AttemptsExhausted,
      "aged-out": WatcherRecoveryOutcome.ResumeDue,
    });
  });

  it("defers owners past the per-tick cap and plans nothing while polling is disabled", () => {
    const planned = planWatcherRecoveries([deadSlot("a", "o1"), deadSlot("b", "o2"), deadSlot("c", "o3")], {}, NOW_MS, false);
    expect(planned.map((recovery) => recovery.outcome)).toEqual([
      WatcherRecoveryOutcome.ResumeDue,
      WatcherRecoveryOutcome.ResumeDue,
      WatcherRecoveryOutcome.DeferredByTickCap,
    ]);
    expect(planWatcherRecoveries([deadSlot("a", "o1")], {}, NOW_MS, true)).toEqual([]);
  });

  it("marks a running idle owner to be stopped first, by the id claude stop takes", () => {
    const planned = planWatcherRecoveries(
      [deadSlot("a", "o1", { isOwnerSessionActive: true }), deadSlot("b", "o2")],
      {},
      NOW_MS,
      false,
      new Map([["o1", liveOwner("o1")]]),
    );
    expect(planned).toEqual([
      { ownerSessionId: "o1", slotSlugs: ["a"], outcome: WatcherRecoveryOutcome.ResumeDue, ownerShortId: "o1-short" },
      { ownerSessionId: "o2", slotSlugs: ["b"], outcome: WatcherRecoveryOutcome.ResumeDue },
    ]);
  });

  it("counts resumes that only hit the usage limit toward the attempt cap", () => {
    const attempts = { limited: [minutesAgo(300), minutesAgo(200), minutesAgo(100)] };
    const planned = planWatcherRecoveries([deadSlot("a", "limited")], attempts, NOW_MS, false, new Map(), (sessionId) => sessionId === "limited");
    expect(planned[0].outcome).toBe(WatcherRecoveryOutcome.AttemptsExhausted);
  });

  it("leaves a running owner at the usage limit to retry its own turn, without spending the tick cap", () => {
    const planned = planWatcherRecoveries(
      [deadSlot("a", "limited", { isOwnerSessionActive: true }), deadSlot("b", "o2"), deadSlot("c", "o3")],
      {},
      NOW_MS,
      false,
      new Map([["limited", liveOwner("limited")]]),
      (sessionId) => sessionId === "limited",
    );
    expect(Object.fromEntries(planned.map((recovery) => [recovery.ownerSessionId, recovery.outcome]))).toEqual({
      limited: WatcherRecoveryOutcome.AwaitingUsageLimitReset,
      o2: WatcherRecoveryOutcome.ResumeDue,
      o3: WatcherRecoveryOutcome.ResumeDue,
    });
  });

  it("finds an owner whose job continued under a newer session id by the short id it started with", () => {
    const ownerSessionId = "030d66e7-1ca3-4e4c";
    const continued = liveOwner("a9667d3f-5225", { shortId: "030d66e7" });
    const slot = deadSlot("a", ownerSessionId);
    const planned = planWatcherRecoveries([slot], {}, NOW_MS, false, new Map([[continued.sessionId, continued]]));
    expect(planned).toEqual([
      {
        ownerSessionId: ownerSessionId,
        slotSlugs: ["a"],
        outcome: WatcherRecoveryOutcome.ResumeDue,
        ownerShortId: "030d66e7",
        ownerRunningSessionId: "a9667d3f-5225",
      },
    ]);
    const busy = liveOwner("a9667d3f-5225", { shortId: "030d66e7", turnStatus: ClaudeTurnStatus.Busy });
    expect(planWatcherRecoveries([slot], {}, NOW_MS, false, new Map([[busy.sessionId, busy]]))).toEqual([]);
    const limited = planWatcherRecoveries([slot], {}, NOW_MS, false, new Map([[continued.sessionId, continued]]), (sessionId) => sessionId === ownerSessionId);
    expect(limited[0].outcome).toBe(WatcherRecoveryOutcome.AwaitingUsageLimitReset);
  });
});

describe("executeWatcherRecoveries", () => {
  function projectsWithTranscript(sessionId: string, cwd: string): string {
    const projectsDir = makeTempDir("projects");
    mkdirSync(join(projectsDir, "proj"));
    writeFileSync(join(projectsDir, "proj", `${sessionId}.jsonl`), `${JSON.stringify({ cwd: cwd })}\n`);
    return projectsDir;
  }

  it("resumes a due owner in the background from its own project dir", () => {
    const projectCwd = makeTempDir("project");
    const projectsDir = projectsWithTranscript("o1", projectCwd);
    const runner = scriptedRunner(() => succeeded("started"));
    const executed = executeWatcherRecoveries(
      [{ ownerSessionId: "o1", slotSlugs: ["a"], outcome: WatcherRecoveryOutcome.ResumeDue }],
      { o1: [minutesAgo(60)], forgotten: [minutesAgo(48 * 60)] },
      executionDeps(runner.runCommand, projectsDir),
    );
    expect(runner.calls).toEqual([
      { executable: "claude", args: ["--resume", "o1", "--bg", "/muggle:muggle-pr-followup reconcile"], options: { cwd: projectCwd } },
    ]);
    expect(executed.recoveries).toEqual([{ ownerSessionId: "o1", slotSlugs: ["a"], outcome: WatcherRecoveryOutcome.Resumed, cwd: projectCwd }]);
    expect(executed.attemptsByOwner).toEqual({ o1: [minutesAgo(60), new Date(NOW_MS).toISOString()] });
    expect(executed.events).toEqual([
      { at: new Date(NOW_MS).toISOString(), kind: WatchEventKind.Resumed, subject: "session o1", message: "resumed to re-arm a" },
    ]);
  });

  it("stops a running idle owner and waits for it to exit before resuming it under the same id", () => {
    const projectCwd = makeTempDir("project");
    const runner = scriptedRunner(() => succeeded("ok"));
    const awaitedSessionIds: string[] = [];
    const executed = executeWatcherRecoveries(
      [{ ownerSessionId: "o1", slotSlugs: ["a"], outcome: WatcherRecoveryOutcome.ResumeDue, ownerShortId: "o1-short" }],
      {},
      executionDeps(runner.runCommand, projectsWithTranscript("o1", projectCwd), {
        waitForExit: (sessionId) => {
          awaitedSessionIds.push(sessionId);
          return true;
        },
      }),
    );
    expect(runner.calls.map((call) => call.args)).toEqual([
      ["stop", "o1-short"],
      ["--resume", "o1", "--bg", "/muggle:muggle-pr-followup reconcile"],
    ]);
    expect(awaitedSessionIds).toEqual(["o1"]);
    expect(executed.recoveries[0].outcome).toBe(WatcherRecoveryOutcome.Resumed);
  });

  it("awaits the exit of the id a continued job runs under before resuming the owner's own id", () => {
    const projectCwd = makeTempDir("project");
    const runner = scriptedRunner(() => succeeded("ok"));
    const awaitedSessionIds: string[] = [];
    executeWatcherRecoveries(
      [
        {
          ownerSessionId: "o1",
          slotSlugs: ["a"],
          outcome: WatcherRecoveryOutcome.ResumeDue,
          ownerShortId: "o1-short",
          ownerRunningSessionId: "o1-continued",
        },
      ],
      {},
      executionDeps(runner.runCommand, projectsWithTranscript("o1", projectCwd), {
        waitForExit: (sessionId) => {
          awaitedSessionIds.push(sessionId);
          return true;
        },
      }),
    );
    expect(awaitedSessionIds).toEqual(["o1-continued"]);
    expect(runner.calls.map((call) => call.args)).toEqual([
      ["stop", "o1-short"],
      ["--resume", "o1", "--bg", "/muggle:muggle-pr-followup reconcile"],
    ]);
  });

  it("does not resume an owner still running after the stop, since that would start a copy", () => {
    const runner = scriptedRunner(() => succeeded("ok"));
    const executed = executeWatcherRecoveries(
      [{ ownerSessionId: "o1", slotSlugs: ["a"], outcome: WatcherRecoveryOutcome.ResumeDue, ownerShortId: "o1-short" }],
      {},
      executionDeps(runner.runCommand, projectsWithTranscript("o1", makeTempDir("project")), { waitForExit: () => false }),
    );
    expect(runner.calls.map((call) => call.args)).toEqual([["stop", "o1-short"]]);
    expect(executed.recoveries[0].outcome).toBe(WatcherRecoveryOutcome.ResumeFailed);
  });

  it("leaves a running owner alone where Claude would not resume it, and waits out the cooldown", () => {
    const projectCwd = makeTempDir("project");
    const runner = scriptedRunner(() => succeeded("ok"));
    const probedCwds: string[] = [];
    const executed = executeWatcherRecoveries(
      [{ ownerSessionId: "o1", slotSlugs: ["a"], outcome: WatcherRecoveryOutcome.ResumeDue, ownerShortId: "o1-short" }],
      {},
      executionDeps(runner.runCommand, projectsWithTranscript("o1", projectCwd), {
        canRestartIn: (cwd) => {
          probedCwds.push(cwd);
          return false;
        },
      }),
    );
    expect(probedCwds).toEqual([projectCwd]);
    expect(runner.calls).toEqual([]);
    expect(executed.recoveries[0].outcome).toBe(WatcherRecoveryOutcome.RestartRefused);
    expect(executed.attemptsByOwner.o1).toHaveLength(1);
    expect(executed.events[0].kind).toBe(WatchEventKind.RestartRefused);
  });

  it("records a failed resume as an attempt so the cooldown still applies", () => {
    const projectsDir = projectsWithTranscript("o1", makeTempDir("project"));
    const executed = executeWatcherRecoveries(
      [{ ownerSessionId: "o1", slotSlugs: ["a"], outcome: WatcherRecoveryOutcome.ResumeDue }],
      {},
      executionDeps(scriptedRunner(() => ({ exitCode: 1, stdout: "" })).runCommand, projectsDir),
    );
    expect(executed.recoveries[0].outcome).toBe(WatcherRecoveryOutcome.ResumeFailed);
    expect(executed.attemptsByOwner.o1).toHaveLength(1);
    expect(executed.events[0].kind).toBe(WatchEventKind.ResumeFailed);
  });

  it("does not run anything when the transcript or its project dir is gone", () => {
    const runner = scriptedRunner(() => succeeded(""));
    const missingCwd = join(makeTempDir("project"), "deleted-worktree");
    const executed = executeWatcherRecoveries(
      [
        { ownerSessionId: "o1", slotSlugs: ["a"], outcome: WatcherRecoveryOutcome.ResumeDue },
        { ownerSessionId: "o2", slotSlugs: ["b"], outcome: WatcherRecoveryOutcome.ResumeDue },
        { ownerSessionId: "o3", slotSlugs: ["c"], outcome: WatcherRecoveryOutcome.CoolingDown },
      ],
      {},
      executionDeps(runner.runCommand, projectsWithTranscript("o2", missingCwd)),
    );
    expect(executed.recoveries.map((recovery) => recovery.outcome)).toEqual([
      WatcherRecoveryOutcome.TranscriptMissing,
      WatcherRecoveryOutcome.TranscriptMissing,
      WatcherRecoveryOutcome.CoolingDown,
    ]);
    expect(runner.calls).toEqual([]);
    expect(executed.attemptsByOwner).toEqual({});
  });
});
