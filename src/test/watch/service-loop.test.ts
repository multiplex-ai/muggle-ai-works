import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { ProviderPrState } from "../../guardrails/types.js";
import { SERVICE_LOOP_DELIVERED_FILE, SERVICE_LOOP_OUTPUT_FILE, SERVICE_LOOP_QUEUED_WAKE_FILE } from "../../pr-watch/constants.js";
import { MAX_SERVICE_ARMS_PER_TICK } from "../../watch/constants.js";
import {
  isServiceArmDue,
  markServiceLoopReportDelivered,
  parseServiceLoopReport,
  queueServiceLoopWakeReport,
  readQueuedWakeReport,
  startServiceLoops,
  undeliveredWakeOf,
} from "../../watch/service-loop.js";
import {
  ClaudeSessionKind,
  ClaudeTurnStatus,
  ServiceArmOutcome,
  ServiceLoopReportKind,
  WatcherLiveness,
  WatchEventKind,
  WorkSessionAgent,
  type SlotPr,
  type WatchSlotAssessment,
  type WorkSession,
} from "../../watch/types.js";
import { makeTempDir } from "./fixtures.js";

const NOW_MS = Date.parse("2026-10-30T12:00:00Z");
const MINUTE_MS = 60_000;

function deadSlot(slug: string, overrides: Partial<WatchSlotAssessment> = {}): WatchSlotAssessment {
  return {
    slug: slug,
    slotDir: `/s/${slug}`,
    pr: { repo: "o/r", number: 7, url: `u-${slug}` },
    isRegistered: true,
    watcher: WatcherLiveness.Dead,
    ownerSessionId: "o1",
    isOwnerSessionActive: true,
    live: { url: `u-${slug}`, state: ProviderPrState.Open, unresolvedThreadCount: 0, baseBranch: "main" },
    isHeardByService: false,
    ...overrides,
  };
}

function ownerSession(turnStatus: ClaudeTurnStatus, kind: ClaudeSessionKind = ClaudeSessionKind.Background): WorkSession {
  return { agent: WorkSessionAgent.Claude, sessionId: "o1", shortId: "o1", kind: kind, turnStatus: turnStatus, pid: 10 };
}

describe("parseServiceLoopReport", () => {
  it("names the reason the loop ended by the first line that gives one, keeping every reason line", () => {
    const output = [
      "DRAIN pr=7 state=OPEN head=abc",
      "ARMED pr=7 watermark seeded",
      "EVENT pr=7 new submitted review id=42",
      "EVENT pr=7 checks settled red head=abc",
    ].join("\n");
    expect(parseServiceLoopReport(output, NOW_MS)).toEqual({
      kind: ServiceLoopReportKind.Event,
      reportLines: ["EVENT pr=7 new submitted review id=42", "EVENT pr=7 checks settled red head=abc"],
      writtenAtMs: NOW_MS,
    });
  });

  it("reads terminal, expiry, failure, and silence", () => {
    expect(parseServiceLoopReport("TERMINAL pr=7 state=MERGED\r\n", NOW_MS).kind).toBe(ServiceLoopReportKind.Terminal);
    expect(parseServiceLoopReport("EXPIRED pr=7 watch lifetime of 604800s reached\n", NOW_MS).kind).toBe(ServiceLoopReportKind.Expired);
    expect(parseServiceLoopReport("ARM-FAIL pr=7 could not read PR state\n", NOW_MS).kind).toBe(ServiceLoopReportKind.Failed);
    expect(parseServiceLoopReport("WATCH-FAIL pr=7 60 consecutive fetch failures\n", NOW_MS).kind).toBe(ServiceLoopReportKind.Failed);
    expect(parseServiceLoopReport("DRAIN pr=7 state=OPEN\nARMED pr=7\n", NOW_MS)).toEqual({
      kind: ServiceLoopReportKind.Silent,
      reportLines: [],
      writtenAtMs: NOW_MS,
    });
  });
});

describe("isServiceArmDue", () => {
  it("starts a loop for a registered open PR whose loop is dead or unheard", () => {
    expect(isServiceArmDue(deadSlot("a"), NOW_MS)).toBe(true);
    expect(isServiceArmDue(deadSlot("a", { watcher: WatcherLiveness.Deaf }), NOW_MS)).toBe(true);
    expect(isServiceArmDue(deadSlot("a", { watcher: WatcherLiveness.Polling }), NOW_MS)).toBe(false);
    expect(isServiceArmDue(deadSlot("a", { watcher: WatcherLiveness.Rearming }), NOW_MS)).toBe(false);
    expect(isServiceArmDue(deadSlot("a", { isRegistered: false }), NOW_MS)).toBe(false);
    expect(isServiceArmDue(deadSlot("a", { ownerSessionId: undefined }), NOW_MS)).toBe(false);
    expect(isServiceArmDue(deadSlot("a", { live: { url: "u", state: ProviderPrState.Merged, unresolvedThreadCount: 0, baseBranch: "main" } }), NOW_MS)).toBe(false);
    expect(isServiceArmDue(deadSlot("a", { live: { url: "u", state: ProviderPrState.Open, unresolvedThreadCount: 0 } }), NOW_MS)).toBe(false);
  });

  it("starts it whatever the owner is doing between turns, but not mid-turn, when that turn may be re-arming it", () => {
    expect(isServiceArmDue(deadSlot("a"), NOW_MS, ownerSession(ClaudeTurnStatus.Idle))).toBe(true);
    expect(isServiceArmDue(deadSlot("a"), NOW_MS, ownerSession(ClaudeTurnStatus.Waiting))).toBe(true);
    expect(isServiceArmDue(deadSlot("a"), NOW_MS, ownerSession(ClaudeTurnStatus.Idle, ClaudeSessionKind.Interactive))).toBe(true);
    expect(isServiceArmDue(deadSlot("a"), NOW_MS, ownerSession(ClaudeTurnStatus.Busy))).toBe(false);
  });

  it("keeps watching a slot whose report has not reached its owner, and waits out the cooldown after a failure", () => {
    const report = (kind: ServiceLoopReportKind, ageMs: number): Partial<WatchSlotAssessment> => ({
      serviceLoopReport: { kind: kind, reportLines: [], writtenAtMs: NOW_MS - ageMs },
    });
    expect(isServiceArmDue(deadSlot("a", report(ServiceLoopReportKind.Event, MINUTE_MS)), NOW_MS)).toBe(true);
    expect(isServiceArmDue(deadSlot("a", report(ServiceLoopReportKind.Terminal, MINUTE_MS)), NOW_MS)).toBe(true);
    expect(isServiceArmDue(deadSlot("a", report(ServiceLoopReportKind.Failed, 5 * MINUTE_MS)), NOW_MS)).toBe(false);
    expect(isServiceArmDue(deadSlot("a", report(ServiceLoopReportKind.Failed, 31 * MINUTE_MS)), NOW_MS)).toBe(true);
    expect(isServiceArmDue(deadSlot("a", report(ServiceLoopReportKind.Expired, MINUTE_MS)), NOW_MS)).toBe(true);
    expect(isServiceArmDue(deadSlot("a", report(ServiceLoopReportKind.Silent, MINUTE_MS)), NOW_MS)).toBe(true);
  });

  it("starts it under a busy owner once a report waits on that owner, since the busy turn never heard the loop", () => {
    const busyOwner = ownerSession(ClaudeTurnStatus.Busy);
    const exited = deadSlot("a", { serviceLoopReport: { kind: ServiceLoopReportKind.Event, reportLines: ["EVENT pr=7 x"], writtenAtMs: NOW_MS } });
    const queued = deadSlot("a", { queuedWakeReport: { kind: ServiceLoopReportKind.Event, reportLines: ["EVENT pr=7 x"], writtenAtMs: NOW_MS } });
    expect(isServiceArmDue(exited, NOW_MS, busyOwner)).toBe(true);
    expect(isServiceArmDue(queued, NOW_MS, busyOwner)).toBe(true);
    expect(isServiceArmDue(deadSlot("a"), NOW_MS, busyOwner)).toBe(false);
  });
});

describe("undeliveredWakeOf", () => {
  const eventReport = { kind: ServiceLoopReportKind.Event, reportLines: ["EVENT pr=7 new conversation comment id=9"], writtenAtMs: NOW_MS };
  const queuedReport = { kind: ServiceLoopReportKind.Event, reportLines: ["EVENT pr=7 new submitted review id=4"], writtenAtMs: NOW_MS - MINUTE_MS };

  it("prefers the exited loop's own report, then a queued one, and ignores a report a running loop is still writing", () => {
    expect(undeliveredWakeOf(deadSlot("a", { serviceLoopReport: eventReport, serviceLoopReportAgeMs: 5, queuedWakeReport: queuedReport }))).toEqual({
      report: eventReport,
      ageMs: 5,
    });
    expect(
      undeliveredWakeOf(
        deadSlot("a", { watcher: WatcherLiveness.Polling, serviceLoopReport: eventReport, queuedWakeReport: queuedReport, queuedWakeReportAgeMs: 7 }),
      ),
    ).toEqual({ report: queuedReport, ageMs: 7 });
    expect(undeliveredWakeOf(deadSlot("a", { watcher: WatcherLiveness.Polling, serviceLoopReport: eventReport }))).toBeUndefined();
    expect(
      undeliveredWakeOf(deadSlot("a", { serviceLoopReport: { kind: ServiceLoopReportKind.Expired, reportLines: [], writtenAtMs: NOW_MS } })),
    ).toBeUndefined();
  });
});

describe("queued wake reports", () => {
  function slotWithOutput(outputText: string, writtenAtMs = NOW_MS - 10 * MINUTE_MS): string {
    const slotDir = makeTempDir("queued-wake");
    const outputPath = join(slotDir, SERVICE_LOOP_OUTPUT_FILE);
    writeFileSync(outputPath, outputText);
    utimesSync(outputPath, writtenAtMs / 1000, writtenAtMs / 1000);
    return slotDir;
  }

  it("moves an exited loop's report into the queue, keeping when the loop reported, so a fresh loop cannot truncate it", () => {
    const slotDir = slotWithOutput("DRAIN pr=7 state=OPEN\nEVENT pr=7 new conversation comment id=9\n");
    expect(queueServiceLoopWakeReport(slotDir)).toBe(true);
    expect(existsSync(join(slotDir, SERVICE_LOOP_OUTPUT_FILE))).toBe(false);
    expect(readQueuedWakeReport(slotDir)).toMatchObject({
      kind: ServiceLoopReportKind.Event,
      reportLines: ["EVENT pr=7 new conversation comment id=9"],
    });
    expect(Math.round(statSync(join(slotDir, SERVICE_LOOP_QUEUED_WAKE_FILE)).mtimeMs / 1000)).toBe(Math.round((NOW_MS - 10 * MINUTE_MS) / 1000));

    writeFileSync(join(slotDir, SERVICE_LOOP_OUTPUT_FILE), "EVENT pr=7 checks settled red head=abc\n");
    expect(queueServiceLoopWakeReport(slotDir)).toBe(true);
    expect(readQueuedWakeReport(slotDir)?.reportLines).toEqual(["EVENT pr=7 new conversation comment id=9", "EVENT pr=7 checks settled red head=abc"]);
  });

  it("leaves an output with nothing for the owner where it is", () => {
    const slotDir = slotWithOutput("EXPIRED pr=7 watch lifetime of 604800s reached\n");
    expect(queueServiceLoopWakeReport(slotDir)).toBe(true);
    expect(existsSync(join(slotDir, SERVICE_LOOP_OUTPUT_FILE))).toBe(true);
    expect(readQueuedWakeReport(slotDir)).toBeUndefined();
  });

  it("sets the queued and the exited loop's reports aside together once delivered", () => {
    const slotDir = slotWithOutput("TERMINAL pr=7 state=MERGED\n");
    writeFileSync(join(slotDir, SERVICE_LOOP_QUEUED_WAKE_FILE), "EVENT pr=7 new conversation comment id=9\n");
    markServiceLoopReportDelivered(slotDir);
    expect(existsSync(join(slotDir, SERVICE_LOOP_OUTPUT_FILE))).toBe(false);
    expect(existsSync(join(slotDir, SERVICE_LOOP_QUEUED_WAKE_FILE))).toBe(false);
    expect(readFileSync(join(slotDir, SERVICE_LOOP_DELIVERED_FILE), "utf-8")).toBe(
      "EVENT pr=7 new conversation comment id=9\nTERMINAL pr=7 state=MERGED\n",
    );
  });

  it("delivers a queued report without touching a fresh loop's output", () => {
    const slotDir = slotWithOutput("DRAIN pr=7 state=OPEN\nARMED pr=7\n");
    writeFileSync(join(slotDir, SERVICE_LOOP_QUEUED_WAKE_FILE), "EVENT pr=7 new conversation comment id=9\n");
    markServiceLoopReportDelivered(slotDir);
    expect(readFileSync(join(slotDir, SERVICE_LOOP_OUTPUT_FILE), "utf-8")).toContain("ARMED pr=7");
    expect(existsSync(join(slotDir, SERVICE_LOOP_QUEUED_WAKE_FILE))).toBe(false);
  });
});

describe("startServiceLoops", () => {
  it("re-arms a slot whose report waits, queueing the report first and claiming the loop for the recorded owner", () => {
    const slotDir = makeTempDir("rearm-pending");
    writeFileSync(join(slotDir, SERVICE_LOOP_OUTPUT_FILE), "EVENT pr=7 new conversation comment id=9\n");
    const launched: Array<{ ownerSessionId: string; isReportQueued: boolean }> = [];
    const started = startServiceLoops(
      [deadSlot("a", { slotDir: slotDir, serviceLoopReport: parseServiceLoopReport("EVENT pr=7 new conversation comment id=9\n", NOW_MS) })],
      NOW_MS,
      false,
      () => ownerSession(ClaudeTurnStatus.Busy),
      (launchedSlotDir, _pr, _baseBranch, ownerSessionId) => {
        launched.push({ ownerSessionId: ownerSessionId, isReportQueued: existsSync(join(launchedSlotDir, SERVICE_LOOP_QUEUED_WAKE_FILE)) });
        return true;
      },
    );
    expect(started.serviceArms.map((serviceArm) => serviceArm.outcome)).toEqual([ServiceArmOutcome.Armed]);
    expect(launched).toEqual([{ ownerSessionId: "o1", isReportQueued: true }]);
  });

  it("starts one loop per due slot on its base branch and logs each start, without touching any session", () => {
    const launched: Array<{ slotDir: string; pr: SlotPr; baseBranch: string }> = [];
    const started = startServiceLoops(
      [deadSlot("a"), deadSlot("a"), deadSlot("b", { watcher: WatcherLiveness.Polling }), deadSlot("c")],
      NOW_MS,
      false,
      () => undefined,
      (slotDir, pr, baseBranch, ownerSessionId) => {
        expect(ownerSessionId).toBe("o1");
        launched.push({ slotDir: slotDir, pr: pr, baseBranch: baseBranch });
        return slotDir !== "/s/c";
      },
    );
    expect(launched.map((launch) => [launch.slotDir, launch.baseBranch])).toEqual([
      ["/s/a", "main"],
      ["/s/c", "main"],
    ]);
    expect(started.serviceArms).toEqual([
      { slug: "a", prUrl: "u-a", outcome: ServiceArmOutcome.Armed },
      { slug: "c", prUrl: "u-c", outcome: ServiceArmOutcome.ArmFailed },
    ]);
    expect(started.events.map((event) => event.kind)).toEqual([WatchEventKind.Armed, WatchEventKind.ArmFailed]);
  });

  it("defers slots past the per-tick cap and starts nothing while polling is disabled", () => {
    const slots = Array.from({ length: MAX_SERVICE_ARMS_PER_TICK + 1 }, (_, index) => deadSlot(`s${index}`));
    const started = startServiceLoops(slots, NOW_MS, false, () => undefined, () => true);
    expect(started.serviceArms.filter((serviceArm) => serviceArm.outcome === ServiceArmOutcome.Armed)).toHaveLength(MAX_SERVICE_ARMS_PER_TICK);
    expect(started.serviceArms[MAX_SERVICE_ARMS_PER_TICK].outcome).toBe(ServiceArmOutcome.DeferredByTickCap);
    let launches = 0;
    expect(startServiceLoops(slots, NOW_MS, true, () => undefined, () => ++launches > 0)).toEqual({ serviceArms: [], events: [] });
    expect(launches).toBe(0);
  });

  it("leaves a slot alone while its owner is mid-turn", () => {
    let launches = 0;
    const started = startServiceLoops([deadSlot("a")], NOW_MS, false, () => ownerSession(ClaudeTurnStatus.Busy), () => ++launches > 0);
    expect(started.serviceArms).toEqual([]);
    expect(launches).toBe(0);
  });
});
