import { describe, expect, it } from "vitest";
import { ProviderPrState } from "../../guardrails/types.js";
import { MAX_SERVICE_ARMS_PER_TICK } from "../../watch/constants.js";
import { isServiceArmDue, parseServiceLoopReport, startServiceLoops } from "../../watch/service-loop.js";
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

  it("holds a slot whose report has not reached its owner, and waits out the cooldown after a failure", () => {
    const report = (kind: ServiceLoopReportKind, ageMs: number): Partial<WatchSlotAssessment> => ({
      serviceLoopReport: { kind: kind, reportLines: [], writtenAtMs: NOW_MS - ageMs },
    });
    expect(isServiceArmDue(deadSlot("a", report(ServiceLoopReportKind.Event, MINUTE_MS)), NOW_MS)).toBe(false);
    expect(isServiceArmDue(deadSlot("a", report(ServiceLoopReportKind.Terminal, MINUTE_MS)), NOW_MS)).toBe(false);
    expect(isServiceArmDue(deadSlot("a", report(ServiceLoopReportKind.Failed, 5 * MINUTE_MS)), NOW_MS)).toBe(false);
    expect(isServiceArmDue(deadSlot("a", report(ServiceLoopReportKind.Failed, 31 * MINUTE_MS)), NOW_MS)).toBe(true);
    expect(isServiceArmDue(deadSlot("a", report(ServiceLoopReportKind.Expired, MINUTE_MS)), NOW_MS)).toBe(true);
    expect(isServiceArmDue(deadSlot("a", report(ServiceLoopReportKind.Silent, MINUTE_MS)), NOW_MS)).toBe(true);
  });
});

describe("startServiceLoops", () => {
  it("starts one loop per due slot on its base branch and logs each start, without touching any session", () => {
    const launched: Array<{ slotDir: string; pr: SlotPr; baseBranch: string }> = [];
    const started = startServiceLoops(
      [deadSlot("a"), deadSlot("a"), deadSlot("b", { watcher: WatcherLiveness.Polling }), deadSlot("c")],
      NOW_MS,
      false,
      () => undefined,
      (slotDir, pr, baseBranch) => {
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
