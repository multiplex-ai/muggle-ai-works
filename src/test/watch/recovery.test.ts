import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { ProviderPrState } from "../../guardrails/types.js";
import { SERVICE_LOOP_DELIVERED_FILE, SERVICE_LOOP_OUTPUT_FILE } from "../../watch/constants.js";
import { executeWatcherRecoveries, isOwnerWakeDue, planWatcherRecoveries } from "../../watch/recovery.js";
import {
  ClaudeSessionKind,
  ClaudeTurnStatus,
  ServiceLoopReportKind,
  WatcherLiveness,
  WatcherRecoveryOutcome,
  WatchEventKind,
  WorkSessionAgent,
  type CommandRunner,
  type RecoveryExecutionDeps,
  type WatcherRecovery,
  type WatchSlotAssessment,
  type WorkSession,
} from "../../watch/types.js";
import { makeTempDir, scriptedRunner, succeeded } from "./fixtures.js";

const NOW_MS = Date.parse("2026-10-24T12:00:00Z");
const MINUTE_MS = 60_000;
const NEW_REVIEW_LINE = "EVENT pr=1 new submitted review id=42";

function reportedSlot(slug: string, ownerSessionId: string, overrides: Partial<WatchSlotAssessment> = {}): WatchSlotAssessment {
  return {
    slug: slug,
    slotDir: `/s/${slug}`,
    pr: { repo: "o/r", number: 1, url: `u-${slug}` },
    isRegistered: true,
    watcher: WatcherLiveness.Dead,
    ownerSessionId: ownerSessionId,
    isOwnerSessionActive: false,
    live: { url: `u-${slug}`, state: ProviderPrState.Open, unresolvedThreadCount: 0 },
    isHeardByService: true,
    serviceLoopReport: { kind: ServiceLoopReportKind.Event, reportLines: [NEW_REVIEW_LINE], writtenAtMs: NOW_MS - MINUTE_MS },
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

function plannedWake(ownerSessionId: string, slotDir: string, overrides: Partial<WatcherRecovery> = {}): WatcherRecovery {
  return {
    ownerSessionId: ownerSessionId,
    slotSlug: "csv",
    slotDir: slotDir,
    prNumber: 7,
    reportKind: ServiceLoopReportKind.Event,
    outcome: WatcherRecoveryOutcome.ResumeDue,
    ...overrides,
  };
}

function slotWithReport(): string {
  const slotDir = makeTempDir("slot");
  writeFileSync(join(slotDir, SERVICE_LOOP_OUTPUT_FILE), `${NEW_REVIEW_LINE}\n`);
  return slotDir;
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
    isSessionRunning: () => false,
    ...overrides,
  };
}

describe("isOwnerWakeDue", () => {
  it("wakes an ended owner only for a registered slot's finished report on a PR still open", () => {
    expect(isOwnerWakeDue(reportedSlot("a", "o1"))).toBe(true);
    expect(isOwnerWakeDue(reportedSlot("a", "o1", { isRegistered: false }))).toBe(false);
    expect(isOwnerWakeDue(reportedSlot("a", "o1", { watcher: WatcherLiveness.Polling }))).toBe(false);
    expect(isOwnerWakeDue(reportedSlot("a", "o1", { serviceLoopReport: undefined }))).toBe(false);
    expect(isOwnerWakeDue(reportedSlot("a", "o1", { ownerSessionId: undefined }))).toBe(false);
    expect(isOwnerWakeDue(reportedSlot("a", "o1", { live: undefined }))).toBe(false);
    expect(isOwnerWakeDue(reportedSlot("a", "o1", { isOwnerSessionActive: undefined }))).toBe(false);
  });

  it("never wakes anyone for a loop that only expired, failed, or was superseded", () => {
    for (const kind of [ServiceLoopReportKind.Expired, ServiceLoopReportKind.Failed, ServiceLoopReportKind.Silent]) {
      expect(isOwnerWakeDue(reportedSlot("a", "o1", { serviceLoopReport: { kind: kind, reportLines: [], writtenAtMs: NOW_MS } }))).toBe(false);
    }
  });

  it("closes out a merged PR of an ended owner instead of resuming it", () => {
    const merged = reportedSlot("a", "o1", {
      live: { url: "u", state: ProviderPrState.Merged, unresolvedThreadCount: 0 },
      serviceLoopReport: { kind: ServiceLoopReportKind.Terminal, reportLines: ["TERMINAL pr=1 state=MERGED"], writtenAtMs: NOW_MS },
    });
    expect(isOwnerWakeDue(merged)).toBe(false);
    expect(isOwnerWakeDue({ ...merged, isOwnerSessionActive: true }, liveOwner("o1"))).toBe(true);
  });

  it("wakes a running owner only between turns of a background session, never mid-turn or while it waits on its user", () => {
    const running = reportedSlot("a", "o1", { isOwnerSessionActive: true });
    expect(isOwnerWakeDue(running, liveOwner("o1"))).toBe(true);
    expect(isOwnerWakeDue(running, liveOwner("o1", { turnStatus: ClaudeTurnStatus.Busy }))).toBe(false);
    expect(isOwnerWakeDue(running, liveOwner("o1", { turnStatus: ClaudeTurnStatus.Waiting }))).toBe(false);
    expect(isOwnerWakeDue(running, liveOwner("o1", { kind: ClaudeSessionKind.Interactive }))).toBe(false);
    expect(isOwnerWakeDue(running)).toBe(false);
  });
});

describe("planWatcherRecoveries", () => {
  it("plans one wake per owner, for its first slot with a report", () => {
    const planned = planWatcherRecoveries([reportedSlot("b", "o1"), reportedSlot("a", "o1"), reportedSlot("c", "o2")], {}, NOW_MS, false);
    expect(planned).toEqual([
      { ownerSessionId: "o1", slotSlug: "a", slotDir: "/s/a", prNumber: 1, reportKind: ServiceLoopReportKind.Event, outcome: WatcherRecoveryOutcome.ResumeDue },
      { ownerSessionId: "o2", slotSlug: "c", slotDir: "/s/c", prNumber: 1, reportKind: ServiceLoopReportKind.Event, outcome: WatcherRecoveryOutcome.ResumeDue },
    ]);
  });

  it("holds an owner inside its cooldown after a failed wake and stops after the attempt cap", () => {
    const planned = planWatcherRecoveries(
      [reportedSlot("a", "cooling"), reportedSlot("b", "exhausted"), reportedSlot("c", "aged-out")],
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
    const planned = planWatcherRecoveries([reportedSlot("a", "o1"), reportedSlot("b", "o2"), reportedSlot("c", "o3")], {}, NOW_MS, false);
    expect(planned.map((recovery) => recovery.outcome)).toEqual([
      WatcherRecoveryOutcome.ResumeDue,
      WatcherRecoveryOutcome.ResumeDue,
      WatcherRecoveryOutcome.DeferredByTickCap,
    ]);
    expect(planWatcherRecoveries([reportedSlot("a", "o1")], {}, NOW_MS, true)).toEqual([]);
  });

  it("marks a running idle owner to be stopped first, by the id claude stop takes", () => {
    const planned = planWatcherRecoveries(
      [reportedSlot("a", "o1", { isOwnerSessionActive: true }), reportedSlot("b", "o2")],
      {},
      NOW_MS,
      false,
      new Map([["o1", liveOwner("o1")]]),
    );
    expect(planned.map((recovery) => [recovery.ownerSessionId, recovery.ownerShortId])).toEqual([
      ["o1", "o1-short"],
      ["o2", undefined],
    ]);
  });

  it("holds every owner while the account sits at a usage limit, before the attempt cap or the tick cap", () => {
    const planned = planWatcherRecoveries(
      [reportedSlot("a", "exhausted"), reportedSlot("b", "o2", { isOwnerSessionActive: true }), reportedSlot("c", "o3"), reportedSlot("d", "o4")],
      { exhausted: [minutesAgo(300), minutesAgo(200), minutesAgo(100)] },
      NOW_MS,
      false,
      new Map([["o2", liveOwner("o2")]]),
      true,
    );
    expect(planned.map((recovery) => recovery.outcome)).toEqual(Array(4).fill(WatcherRecoveryOutcome.AwaitingUsageLimitReset));
  });

  it("finds an owner whose job continued under a newer session id by the short id it started with", () => {
    const ownerSessionId = "030d66e7-1ca3-4e4c";
    const continued = liveOwner("a9667d3f-5225", { shortId: "030d66e7" });
    const slot = reportedSlot("a", ownerSessionId, { isOwnerSessionActive: true });
    const planned = planWatcherRecoveries([slot], {}, NOW_MS, false, new Map([[continued.sessionId, continued]]));
    expect(planned.map((recovery) => [recovery.ownerShortId, recovery.ownerRunningSessionId])).toEqual([["030d66e7", "a9667d3f-5225"]]);
    const busy = liveOwner("a9667d3f-5225", { shortId: "030d66e7", turnStatus: ClaudeTurnStatus.Busy });
    expect(planWatcherRecoveries([slot], {}, NOW_MS, false, new Map([[busy.sessionId, busy]]))).toEqual([]);
  });
});

describe("executeWatcherRecoveries", () => {
  function projectsWithTranscript(sessionId: string, cwd: string): string {
    const projectsDir = makeTempDir("projects");
    mkdirSync(join(projectsDir, "proj"));
    writeFileSync(join(projectsDir, "proj", `${sessionId}.jsonl`), `${JSON.stringify({ cwd: cwd })}\n`);
    return projectsDir;
  }

  it("wakes an owner with its own slot and PR only, never a reconcile sweep, and sets the report aside", () => {
    const projectCwd = makeTempDir("project");
    const slotDir = slotWithReport();
    const runner = scriptedRunner(() => succeeded("started"));
    const executed = executeWatcherRecoveries(
      [plannedWake("o1", slotDir)],
      { o1: [minutesAgo(60)], forgotten: [minutesAgo(48 * 60)] },
      executionDeps(runner.runCommand, projectsWithTranscript("o1", projectCwd)),
    );
    expect(runner.calls).toEqual([
      { executable: "claude", args: ["--resume", "o1", "--bg", "/muggle:muggle-pr-followup csv 7 --wake=event"], options: { cwd: projectCwd, isStderrCaptured: true } },
    ]);
    expect(runner.calls.some((call) => call.args.join(" ").includes("reconcile"))).toBe(false);
    expect(executed.recoveries[0].outcome).toBe(WatcherRecoveryOutcome.Resumed);
    expect(existsSync(join(slotDir, SERVICE_LOOP_OUTPUT_FILE))).toBe(false);
    expect(existsSync(join(slotDir, SERVICE_LOOP_DELIVERED_FILE))).toBe(true);
    expect(executed.attemptsByOwner).toEqual({ o1: [minutesAgo(60)] });
    expect(executed.events).toEqual([
      { at: new Date(NOW_MS).toISOString(), kind: WatchEventKind.Resumed, subject: "session o1", message: "woke it with /muggle:muggle-pr-followup csv 7 --wake=event" },
    ]);
  });

  it("stops a running idle owner and waits for it to exit before resuming it under the same id", () => {
    const runner = scriptedRunner(() => succeeded("ok"));
    const awaitedSessionIds: string[] = [];
    const executed = executeWatcherRecoveries(
      [plannedWake("o1", slotWithReport(), { ownerShortId: "o1-short", ownerRunningSessionId: "o1-continued" })],
      {},
      executionDeps(runner.runCommand, projectsWithTranscript("o1", makeTempDir("project")), {
        waitForExit: (sessionId) => {
          awaitedSessionIds.push(sessionId);
          return true;
        },
      }),
    );
    expect(runner.calls.map((call) => call.args)).toEqual([
      ["stop", "o1-short"],
      ["--resume", "o1", "--bg", "/muggle:muggle-pr-followup csv 7 --wake=event"],
    ]);
    expect(awaitedSessionIds).toEqual(["o1-continued"]);
    expect(executed.recoveries[0].outcome).toBe(WatcherRecoveryOutcome.Resumed);
  });

  it("keeps the report and counts the attempt when the owner outlives its stop, so no copy of it starts", () => {
    const slotDir = slotWithReport();
    const runner = scriptedRunner(() => succeeded("ok"));
    const executed = executeWatcherRecoveries(
      [plannedWake("o1", slotDir, { ownerShortId: "o1-short" })],
      {},
      executionDeps(runner.runCommand, projectsWithTranscript("o1", makeTempDir("project")), { waitForExit: () => false }),
    );
    expect(runner.calls.map((call) => call.args)).toEqual([["stop", "o1-short"]]);
    expect(executed.recoveries[0].outcome).toBe(WatcherRecoveryOutcome.ResumeFailed);
    expect(existsSync(join(slotDir, SERVICE_LOOP_OUTPUT_FILE))).toBe(true);
    expect(executed.attemptsByOwner.o1).toHaveLength(1);
  });

  it("leaves a running owner alone where Claude would not resume it, and waits out the cooldown", () => {
    const projectCwd = makeTempDir("project");
    const runner = scriptedRunner(() => succeeded("ok"));
    const probedCwds: string[] = [];
    const executed = executeWatcherRecoveries(
      [plannedWake("o1", slotWithReport(), { ownerShortId: "o1-short" })],
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

  it("records a failed wake as an attempt so the cooldown still applies", () => {
    const executed = executeWatcherRecoveries(
      [plannedWake("o1", slotWithReport())],
      {},
      executionDeps(scriptedRunner(() => ({ exitCode: 1, stdout: "" })).runCommand, projectsWithTranscript("o1", makeTempDir("project"))),
    );
    expect(executed.recoveries[0].outcome).toBe(WatcherRecoveryOutcome.ResumeFailed);
    expect(executed.attemptsByOwner.o1).toHaveLength(1);
    expect(executed.events[0].kind).toBe(WatchEventKind.ResumeFailed);
  });

  it("counts a resume Claude answered with the owner's own id as a wake", () => {
    const owner = "a0944a7f-a085-43dd-9408-fa76d72fad4a";
    const runner = scriptedRunner((executable, args) =>
      args[0] === "--resume" ? succeeded("note: woke session a0944a7f with its saved options (--name).\nbackgrounded · a0944a7f\n") : succeeded("ok"),
    );
    const executed = executeWatcherRecoveries(
      [plannedWake(owner, slotWithReport(), { ownerShortId: "a0944a7f" })],
      {},
      executionDeps(runner.runCommand, projectsWithTranscript(owner, makeTempDir("project"))),
    );
    expect(runner.calls.map((call) => call.args[0])).toEqual(["stop", "--resume"]);
    expect(executed.recoveries[0].outcome).toBe(WatcherRecoveryOutcome.Resumed);
  });

  it("removes the copy Claude starts when it still runs the owner, and keeps the report for a later wake", () => {
    const owner = "a0944a7f-a085-43dd-9408-fa76d72fad4a";
    const slotDir = slotWithReport();
    const runner = scriptedRunner((executable, args) =>
      args[0] === "--resume"
        ? succeeded("backgrounded · 9abf32dd\nnote: session a0944a7f is already running in the background, so this started a copy as 9abf32dd.\n")
        : succeeded("ok"),
    );
    const executed = executeWatcherRecoveries(
      [plannedWake(owner, slotDir, { ownerShortId: "a0944a7f" })],
      {},
      executionDeps(runner.runCommand, projectsWithTranscript(owner, makeTempDir("project"))),
    );
    expect(runner.calls.map((call) => call.args.slice(0, 2))).toEqual([
      ["stop", "a0944a7f"],
      ["--resume", owner],
      ["stop", "9abf32dd"],
      ["rm", "9abf32dd"],
    ]);
    expect(executed.recoveries[0].outcome).toBe(WatcherRecoveryOutcome.ResumeForked);
    expect(existsSync(join(slotDir, SERVICE_LOOP_OUTPUT_FILE))).toBe(true);
    expect(executed.attemptsByOwner[owner]).toHaveLength(1);
    expect(executed.events).toEqual([
      {
        at: new Date(NOW_MS).toISOString(),
        kind: WatchEventKind.ResumeForked,
        subject: "session a0944a7f",
        message: "could not wake it: Claude still ran it and started copy 9abf32dd instead; stopped and removed the copy",
      },
    ]);
  });

  it("names the copy to remove by hand when Claude would not remove it", () => {
    const runner = scriptedRunner((executable, args) => {
      if (args[0] === "--resume") return succeeded("backgrounded · c0ffee12\n");
      return args[0] === "rm" ? { exitCode: 1, stdout: "" } : succeeded("ok");
    });
    const executed = executeWatcherRecoveries(
      [plannedWake("o1", slotWithReport())],
      {},
      executionDeps(runner.runCommand, projectsWithTranscript("o1", makeTempDir("project"))),
    );
    expect(executed.recoveries[0].outcome).toBe(WatcherRecoveryOutcome.ResumeForked);
    expect(executed.events[0].message).toContain("could not remove the copy, run claude rm c0ffee12");
  });

  it("does not resume an owner the listing left out while Claude's registry still runs it", () => {
    const slotDir = slotWithReport();
    const runner = scriptedRunner(() => succeeded("ok"));
    const checkedSessionIds: string[] = [];
    const executed = executeWatcherRecoveries(
      [plannedWake("o1", slotDir)],
      {},
      executionDeps(runner.runCommand, projectsWithTranscript("o1", makeTempDir("project")), {
        isSessionRunning: (sessionId) => {
          checkedSessionIds.push(sessionId);
          return true;
        },
      }),
    );
    expect(checkedSessionIds).toEqual(["o1"]);
    expect(runner.calls).toEqual([]);
    expect(executed.recoveries[0].outcome).toBe(WatcherRecoveryOutcome.ResumeFailed);
    expect(existsSync(join(slotDir, SERVICE_LOOP_OUTPUT_FILE))).toBe(true);
    expect(executed.attemptsByOwner.o1).toHaveLength(1);
    expect(executed.events[0].message).toBe("could not wake it: it is still running, so a resume would start a copy");
  });

  it("does not run anything when the transcript or its project dir is gone", () => {
    const runner = scriptedRunner(() => succeeded(""));
    const missingCwd = join(makeTempDir("project"), "deleted-worktree");
    const executed = executeWatcherRecoveries(
      [
        plannedWake("o1", "/s/a"),
        plannedWake("o2", "/s/b"),
        plannedWake("o3", "/s/c", { outcome: WatcherRecoveryOutcome.CoolingDown }),
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
