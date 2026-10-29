import { describe, expect, it } from "vitest";
import { ProviderPrState } from "../../guardrails/types.js";
import {
  assessWatchSlots,
  deriveWatchFindings,
  reconcileActiveFindings,
  resolveWatcherLiveness,
} from "../../watch/findings.js";
import {
  CiRollupState,
  OwnerEscalationKind,
  PrMergeable,
  PrMergeStateStatus,
  TrackedProcessKind,
  WatcherLiveness,
  WatchFindingCode,
  WatchFindingSeverity,
  type PrLiveStatus,
  type TrackedProcess,
  type WatchSlotAssessment,
} from "../../watch/types.js";

const MINUTE_MS = 60_000;
const NOW_MS = 1_800_000_000_000;

function loop(slug: string, ageMs: number, pid = 900): TrackedProcess {
  return { pid: pid, parentPid: 1, kind: TrackedProcessKind.PrWatchLoop, ageMs: ageMs, watchSlotSlug: slug };
}

describe("resolveWatcherLiveness", () => {
  it("hears a young loop under a live owner", () => {
    expect(resolveWatcherLiveness(loop("s", 5 * MINUTE_MS), 30_000, true, true)).toBe(WatcherLiveness.Polling);
    expect(resolveWatcherLiveness(loop("s", 5 * MINUTE_MS), 30_000, undefined, true)).toBe(WatcherLiveness.Polling);
  });

  it("calls a loop deaf once its owner has ended", () => {
    expect(resolveWatcherLiveness(loop("s", 5 * MINUTE_MS), 30_000, false, true)).toBe(WatcherLiveness.Deaf);
    expect(resolveWatcherLiveness({ ...loop("s", 0), ageMs: undefined }, 30_000, true, true)).toBe(WatcherLiveness.Polling);
  });

  // A background shell has no read cap, so a quiet PR's loop runs for days.
  it("hears a loop of any age under a live owner", () => {
    expect(resolveWatcherLiveness(loop("s", 3 * 24 * 60 * MINUTE_MS), 30_000, true, true)).toBe(WatcherLiveness.Polling);
  });

  it("gives a missing loop the re-arm hand-off before calling it dead", () => {
    expect(resolveWatcherLiveness(undefined, 2 * MINUTE_MS, true, true)).toBe(WatcherLiveness.Rearming);
    expect(resolveWatcherLiveness(undefined, 6 * MINUTE_MS, true, true)).toBe(WatcherLiveness.Dead);
    expect(resolveWatcherLiveness(undefined, undefined, true, true)).toBe(WatcherLiveness.Dead);
  });

  it("falls back to the heartbeat alone when the process table is unknown", () => {
    expect(resolveWatcherLiveness(undefined, 10 * MINUTE_MS, true, false)).toBe(WatcherLiveness.Polling);
    expect(resolveWatcherLiveness(undefined, 20 * MINUTE_MS, true, false)).toBe(WatcherLiveness.Dead);
  });
});

describe("assessWatchSlots", () => {
  const slot = {
    slug: "csv",
    slotDir: "/s/csv",
    ownerSessionId: "owner-1",
    heartbeatMtimeMs: NOW_MS - 10 * MINUTE_MS,
    isRegistered: true,
    openPrs: [
      { repo: "o/r", number: 1, url: "u1" },
      { repo: "o/r", number: 2, url: "u2" },
    ],
    lastSeenJson: "",
    followupLogLines: [],
  };

  it("judges one assessment per PR, matching the oldest loop for the slot", () => {
    const live: PrLiveStatus = { url: "u1", state: ProviderPrState.Open, unresolvedThreadCount: 0 };
    const assessments = assessWatchSlots(
      [slot],
      [loop("csv", MINUTE_MS, 11), loop("csv", 4 * MINUTE_MS, 10), loop("other", 99 * MINUTE_MS, 12)],
      new Set(["owner-1"]),
      new Map([["u1", live]]),
      NOW_MS,
    );
    expect(assessments).toHaveLength(2);
    expect(assessments[0]).toMatchObject({
      slug: "csv",
      watcher: WatcherLiveness.Polling,
      loopPid: 10,
      loopAgeMs: 4 * MINUTE_MS,
      heartbeatAgeMs: 10 * MINUTE_MS,
      isOwnerSessionActive: true,
      isRegistered: true,
      live: live,
    });
    expect(assessments[1].live).toBeUndefined();
  });

  it("attaches what the watcher escalated on each PR's live head", () => {
    const escalatedSlot = {
      ...slot,
      lastSeenJson: JSON.stringify({ "o/r#1": { ci_fix_attempts: { head1: 1 }, ci_escalated_shas: ["head1"] } }),
      followupLogLines: ["2026-10-27T08:10:20Z fix-ci pr=1 head=head1 escalated: awaiting owner decision"],
    };
    const live: PrLiveStatus = { url: "u1", state: ProviderPrState.Open, headSha: "head1", unresolvedThreadCount: 0 };
    const assessments = assessWatchSlots([escalatedSlot], [], new Set(["owner-1"]), new Map([["u1", live]]), NOW_MS);
    expect(assessments[0].ownerEscalation).toEqual({
      kinds: [OwnerEscalationKind.Ci],
      note: "fix-ci pr=1 head=head1 escalated: awaiting owner decision",
    });
    expect(assessments[1].ownerEscalation).toBeUndefined();
  });

  it("leaves owner liveness unknown without a session listing or an owner", () => {
    expect(assessWatchSlots([slot], [], null, new Map(), NOW_MS)[0].isOwnerSessionActive).toBeUndefined();
    const unowned = { ...slot, ownerSessionId: undefined, heartbeatMtimeMs: undefined };
    expect(assessWatchSlots([unowned], null, new Set(), new Map(), NOW_MS)[0]).toMatchObject({
      isOwnerSessionActive: undefined,
      heartbeatAgeMs: undefined,
      watcher: WatcherLiveness.Dead,
    });
  });
});

function assessment(overrides: Partial<WatchSlotAssessment>): WatchSlotAssessment {
  return {
    slug: "csv",
    slotDir: "/s/csv",
    pr: { repo: "o/r", number: 7, url: "u7" },
    isRegistered: true,
    watcher: WatcherLiveness.Polling,
    ownerSessionId: "owner-123456789",
    isOwnerSessionActive: true,
    live: { url: "u7", state: ProviderPrState.Open, headSha: "abcdef0123", unresolvedThreadCount: 0 },
    ...overrides,
  };
}

function codesOf(assessments: WatchSlotAssessment[], processes: TrackedProcess[] = [], isPollingDisabled = false): WatchFindingCode[] {
  return deriveWatchFindings(assessments, processes, isPollingDisabled).map((current) => current.code);
}

describe("deriveWatchFindings", () => {
  it("reports nothing for a healthy, quiet PR", () => {
    expect(codesOf([assessment({})])).toEqual([]);
  });

  it("reports a dead watcher with what its owner situation allows", () => {
    const messages = [
      assessment({ watcher: WatcherLiveness.Dead, heartbeatAgeMs: 90 * MINUTE_MS }),
      assessment({ watcher: WatcherLiveness.Dead, isOwnerSessionActive: false }),
      assessment({ watcher: WatcherLiveness.Dead, isOwnerSessionActive: false, isRegistered: false }),
      assessment({ watcher: WatcherLiveness.Dead, ownerSessionId: undefined }),
      assessment({ watcher: WatcherLiveness.Dead, isOwnerSessionActive: undefined }),
    ].map((current) => deriveWatchFindings([current], [], false)[0].message);
    expect(messages[0]).toBe("no watch loop is running (heartbeat 1h30m old); owner session owner-12 is running — run /muggle:muggle-pr-followup reconcile there, or the watch does once it idles in the background");
    expect(messages[1]).toBe("no watch loop is running (no heartbeat); owner session owner-12 has ended");
    expect(messages[2]).toContain("not registered for recovery");
    expect(messages[3]).toContain("adopt it with /muggle:muggle-pr-followup adopt csv");
    expect(messages[4]).toContain("could not be checked");
  });

  it("explains why a deaf loop is unheard", () => {
    const ownerGone = deriveWatchFindings([assessment({ watcher: WatcherLiveness.Deaf, loopPid: 42, isOwnerSessionActive: false })], [], false)[0];
    expect(ownerGone).toMatchObject({ code: WatchFindingCode.WatcherDeaf, severity: WatchFindingSeverity.Alert, key: "WATCHER_DEAF:u7:42" });
    expect(ownerGone.message).toContain("owner session owner-12 has ended");
  });

  it("silences watcher findings while polling is disabled", () => {
    expect(codesOf([assessment({ watcher: WatcherLiveness.Dead })], [], true)).toEqual([]);
  });

  it("keys CI and branch findings by head so a new push raises again", () => {
    const live: PrLiveStatus = {
      url: "u7",
      state: ProviderPrState.Open,
      headSha: "abcdef0123",
      ciRollup: CiRollupState.Failure,
      mergeable: PrMergeable.Conflicting,
      unresolvedThreadCount: 1,
    };
    const findings = deriveWatchFindings([assessment({ live: live })], [], false);
    expect(findings.map((current) => current.key)).toEqual([
      "CI_FAILING:u7:abcdef0123",
      "BASE_CONFLICT:u7:abcdef0123",
      "REVIEW_THREADS_UNRESOLVED:u7",
    ]);
    expect(findings[0].message).toBe("checks on abcdef01 are failure");
    expect(findings[2].message).toBe("1 unresolved review thread");
  });

  it("says which escalated work waits on the owner, ahead of the red CI it explains", () => {
    const live: PrLiveStatus = { url: "u7", state: ProviderPrState.Open, headSha: "abcdef0123", ciRollup: CiRollupState.Failure, unresolvedThreadCount: 0 };
    const ownerEscalation = { kinds: [OwnerEscalationKind.Ci, OwnerEscalationKind.Conflict], note: "fix-ci pr=7 escalated: pick a fix" };
    const findings = deriveWatchFindings([assessment({ live: live, ownerEscalation: ownerEscalation })], [], false);
    expect(findings.map((current) => current.code)).toEqual([WatchFindingCode.AwaitingOwner, WatchFindingCode.CiFailing]);
    expect(findings[0]).toMatchObject({
      key: "AWAITING_OWNER:u7:abcdef0123:ci+conflict",
      severity: WatchFindingSeverity.Alert,
      subject: "o/r#7",
      message: "watcher escalated ci, conflict on abcdef01 to owner session owner-12; a decision waits on you — fix-ci pr=7 escalated: pick a fix",
    });
    const unowned = deriveWatchFindings([assessment({ ownerSessionId: undefined, ownerEscalation: { kinds: [OwnerEscalationKind.Reviews] } })], [], false);
    expect(unowned[0].message).toBe("watcher escalated reviews on abcdef01 to no owner session; a decision waits on you");
  });

  it("reports an errored rollup, a dirty or behind branch, and plural threads", () => {
    const dirty = { url: "u7", state: ProviderPrState.Open, mergeStateStatus: PrMergeStateStatus.Dirty, ciRollup: CiRollupState.Error, unresolvedThreadCount: 3 };
    expect(codesOf([assessment({ live: dirty })])).toEqual([
      WatchFindingCode.CiFailing,
      WatchFindingCode.BaseConflict,
      WatchFindingCode.ReviewThreadsUnresolved,
    ]);
    expect(deriveWatchFindings([assessment({ live: dirty })], [], false)[2].message).toBe("3 unresolved review threads");
    const behind = { url: "u7", state: ProviderPrState.Open, mergeStateStatus: PrMergeStateStatus.Behind, unresolvedThreadCount: 0 };
    expect(deriveWatchFindings([assessment({ live: behind })], [], false)[0]).toMatchObject({
      code: WatchFindingCode.BehindBase,
      severity: WatchFindingSeverity.Warning,
      message: "head ? is behind its base",
    });
  });

  it("reports only the unfinalized slot for a PR GitHub says is terminal", () => {
    const merged = { url: "u7", state: ProviderPrState.Merged, ciRollup: CiRollupState.Failure, unresolvedThreadCount: 0 };
    const closed = { ...merged, state: ProviderPrState.Closed };
    expect(codesOf([assessment({ live: merged, watcher: WatcherLiveness.Dead }), assessment({ live: closed })])).toEqual([
      WatchFindingCode.SlotTerminalUnfinalized,
      WatchFindingCode.SlotTerminalUnfinalized,
    ]);
  });

  // GitHub unreachable must not turn every merged PR's stopped loop into a dead-watcher alert.
  it("reports only the missing status for a PR GitHub did not answer for", () => {
    const findings = deriveWatchFindings([assessment({ live: undefined, watcher: WatcherLiveness.Dead })], [], false);
    expect(findings.map((current) => current.code)).toEqual([WatchFindingCode.PrStatusUnavailable]);
    expect(findings[0].message).toBe("GitHub did not return this PR's status (watcher dead)");
  });

  it("reports orphaned muggle MCP servers and nothing for attached ones", () => {
    const servers: TrackedProcess[] = [
      { pid: 5, parentPid: 1, kind: TrackedProcessKind.MuggleMcpServer, isOrphaned: true },
      { pid: 6, parentPid: 1, kind: TrackedProcessKind.MuggleMcpServer, isOrphaned: false },
      { pid: 7, parentPid: 1, kind: TrackedProcessKind.ClaudeCli, isOrphaned: true },
    ];
    expect(deriveWatchFindings([], servers, false)).toEqual([
      {
        key: "ORPHANED_MCP_SERVER:5",
        code: WatchFindingCode.OrphanedMcpServer,
        severity: WatchFindingSeverity.Warning,
        subject: "pid 5",
        message: "muggle MCP server outlived the agent that launched it",
      },
    ]);
  });
});

describe("reconcileActiveFindings", () => {
  it("raises new findings, keeps first-seen times, and clears what is gone", () => {
    const kept = { key: "k1", code: WatchFindingCode.CiFailing, severity: WatchFindingSeverity.Alert, subject: "s", message: "now" };
    const fresh = { ...kept, key: "k3" };
    const previous = {
      k1: { code: WatchFindingCode.CiFailing, severity: WatchFindingSeverity.Alert, subject: "s", message: "then", firstSeenAt: "t0" },
      k2: { code: WatchFindingCode.BehindBase, severity: WatchFindingSeverity.Warning, subject: "s", message: "m", firstSeenAt: "t0" },
    };
    const transitions = reconcileActiveFindings(previous, [kept, fresh], "t1");
    expect(transitions.raised).toEqual([fresh]);
    expect(transitions.cleared).toEqual([{ key: "k2", record: previous.k2 }]);
    expect(transitions.activeFindings.k1).toMatchObject({ firstSeenAt: "t0", message: "now" });
    expect(transitions.activeFindings.k3.firstSeenAt).toBe("t1");
  });
});
