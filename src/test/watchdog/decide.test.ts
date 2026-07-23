import { describe, it, expect } from "vitest";
import { decideSlotAction, emptyWatchdogSlotState } from "../../watchdog/decide.js";
import { computeSlotSignature } from "../../watchdog/signature.js";
import {
  CiRollupBucket,
  SlotDecisionInput,
  SlotPollSnapshot,
  SlotSkipReason,
  SlotWatchAction,
  SpawnTickReason,
  WatchdogSlotState,
} from "../../watchdog/types.js";

const NOW_MS = Date.parse("2026-07-23T12:00:00Z");
const MINUTE_MS = 60 * 1000;
const CONFIRM_AFTER_MS = 4 * MINUTE_MS;
const RETRY_AFTER_MS = 10 * MINUTE_MS;

function snapshot(overrides: Partial<SlotPollSnapshot> = {}): SlotPollSnapshot {
  return {
    prState: "OPEN",
    headSha: "abc1234",
    actionableThreadIds: [],
    actionableBodyReviewIds: [],
    behindBy: 0,
    isConflicting: false,
    ciBucket: CiRollupBucket.Pass,
    ...overrides,
  };
}

function decisionInput(
  pollSnapshot: SlotPollSnapshot,
  overrides: Partial<SlotDecisionInput> = {},
): SlotDecisionInput {
  return {
    isWatcherLive: false,
    isCycleInProgress: false,
    pollSnapshot: pollSnapshot,
    signature: computeSlotSignature(pollSnapshot),
    storedSlotState: emptyWatchdogSlotState(),
    newestFollowupLogTimestampMs: null,
    nowMs: NOW_MS,
    confirmSignalAfterMs: CONFIRM_AFTER_MS,
    spawnRetryAfterMs: RETRY_AFTER_MS,
    ...overrides,
  };
}

describe("decideSlotAction", () => {
  it("a live watcher owns the slot regardless of signals", () => {
    const decision = decideSlotAction(
      decisionInput(snapshot({ prState: "MERGED" }), { isWatcherLive: true }),
    );
    expect(decision.action).toBe(SlotWatchAction.Skip);
    expect(decision.skipReason).toBe(SlotSkipReason.WatcherLive);
  });

  it("an in-flight cycle owns the slot regardless of signals", () => {
    const decision = decideSlotAction(
      decisionInput(snapshot({ actionableThreadIds: ["T1"] }), { isCycleInProgress: true }),
    );
    expect(decision.action).toBe(SlotWatchAction.Skip);
    expect(decision.skipReason).toBe(SlotSkipReason.CycleInProgress);
  });

  it("no signal → skip, clearing any stale pending record", () => {
    const stored: WatchdogSlotState = {
      ...emptyWatchdogSlotState(),
      pending_signature: "old-signature",
      pending_seen_at: new Date(NOW_MS - 30 * MINUTE_MS).toISOString(),
    };
    const decision = decideSlotAction(decisionInput(snapshot(), { storedSlotState: stored }));
    expect(decision.action).toBe(SlotWatchAction.Skip);
    expect(decision.skipReason).toBe(SlotSkipReason.NoSignal);
    expect(decision.updatedSlotState?.pending_signature).toBeNull();
  });

  it("a terminal PR spawns immediately — no confirmation round", () => {
    const decision = decideSlotAction(decisionInput(snapshot({ prState: "MERGED" })));
    expect(decision.action).toBe(SlotWatchAction.SpawnTick);
    expect(decision.spawnReason).toBe(SpawnTickReason.TerminalPr);
    expect(decision.updatedSlotState?.spawn_attempts).toBe(1);
  });

  it("a non-terminal signal is recorded pending on first sight", () => {
    const decision = decideSlotAction(decisionInput(snapshot({ actionableThreadIds: ["T1"] })));
    expect(decision.action).toBe(SlotWatchAction.RecordPendingSignal);
    expect(decision.updatedSlotState?.pending_signature).toBeTruthy();
  });

  it("the same signal confirmed one scan later spawns", () => {
    const pollSnapshot = snapshot({ actionableThreadIds: ["T1"] });
    const stored: WatchdogSlotState = {
      ...emptyWatchdogSlotState(),
      pending_signature: computeSlotSignature(pollSnapshot),
      pending_seen_at: new Date(NOW_MS - 5 * MINUTE_MS).toISOString(),
    };
    const decision = decideSlotAction(decisionInput(pollSnapshot, { storedSlotState: stored }));
    expect(decision.action).toBe(SlotWatchAction.SpawnTick);
    expect(decision.spawnReason).toBe(SpawnTickReason.ConfirmedSignal);
    expect(decision.updatedSlotState?.pending_signature).toBeNull();
  });

  it("a pending signal younger than the confirm window keeps waiting", () => {
    const pollSnapshot = snapshot({ actionableThreadIds: ["T1"] });
    const stored: WatchdogSlotState = {
      ...emptyWatchdogSlotState(),
      pending_signature: computeSlotSignature(pollSnapshot),
      pending_seen_at: new Date(NOW_MS - 1 * MINUTE_MS).toISOString(),
    };
    const decision = decideSlotAction(decisionInput(pollSnapshot, { storedSlotState: stored }));
    expect(decision.action).toBe(SlotWatchAction.Skip);
    expect(decision.skipReason).toBe(SlotSkipReason.AwaitingSignalConfirmation);
  });

  it("a changed signal re-records pending instead of confirming the old one", () => {
    const stored: WatchdogSlotState = {
      ...emptyWatchdogSlotState(),
      pending_signature: "different-signature",
      pending_seen_at: new Date(NOW_MS - 30 * MINUTE_MS).toISOString(),
    };
    const decision = decideSlotAction(
      decisionInput(snapshot({ actionableThreadIds: ["T1"] }), { storedSlotState: stored }),
    );
    expect(decision.action).toBe(SlotWatchAction.RecordPendingSignal);
  });

  it("a spawned signature whose tick demonstrably ran never respawns", () => {
    const pollSnapshot = snapshot({ behindBy: 2 });
    const spawnedAtMs = NOW_MS - 30 * MINUTE_MS;
    const stored: WatchdogSlotState = {
      ...emptyWatchdogSlotState(),
      last_spawn_signature: computeSlotSignature(pollSnapshot),
      last_spawn_at: new Date(spawnedAtMs).toISOString(),
      spawn_attempts: 1,
    };
    const decision = decideSlotAction(
      decisionInput(pollSnapshot, {
        storedSlotState: stored,
        newestFollowupLogTimestampMs: spawnedAtMs + 2 * MINUTE_MS,
      }),
    );
    expect(decision.action).toBe(SlotWatchAction.Skip);
    expect(decision.skipReason).toBe(SlotSkipReason.AlreadyHandled);
  });

  it("an unconfirmed spawn inside the retry window waits", () => {
    const pollSnapshot = snapshot({ behindBy: 2 });
    const stored: WatchdogSlotState = {
      ...emptyWatchdogSlotState(),
      last_spawn_signature: computeSlotSignature(pollSnapshot),
      last_spawn_at: new Date(NOW_MS - 5 * MINUTE_MS).toISOString(),
      spawn_attempts: 1,
    };
    const decision = decideSlotAction(decisionInput(pollSnapshot, { storedSlotState: stored }));
    expect(decision.action).toBe(SlotWatchAction.Skip);
    expect(decision.skipReason).toBe(SlotSkipReason.AwaitingSpawnRetryWindow);
  });

  it("an unconfirmed spawn past the retry window retries — the limit-reset path", () => {
    const pollSnapshot = snapshot({ behindBy: 2 });
    const stored: WatchdogSlotState = {
      ...emptyWatchdogSlotState(),
      last_spawn_signature: computeSlotSignature(pollSnapshot),
      last_spawn_at: new Date(NOW_MS - 15 * MINUTE_MS).toISOString(),
      spawn_attempts: 1,
    };
    const decision = decideSlotAction(decisionInput(pollSnapshot, { storedSlotState: stored }));
    expect(decision.action).toBe(SlotWatchAction.SpawnTick);
    expect(decision.spawnReason).toBe(SpawnTickReason.SpawnRetry);
    expect(decision.updatedSlotState?.spawn_attempts).toBe(2);
  });

  it("a new signature after a handled one goes through pending, not straight to spawn", () => {
    const handledSnapshot = snapshot({ behindBy: 2 });
    const newSnapshot = snapshot({ behindBy: 2, headSha: "def5678" });
    const spawnedAtMs = NOW_MS - 60 * MINUTE_MS;
    const stored: WatchdogSlotState = {
      ...emptyWatchdogSlotState(),
      last_spawn_signature: computeSlotSignature(handledSnapshot),
      last_spawn_at: new Date(spawnedAtMs).toISOString(),
      spawn_attempts: 1,
    };
    const decision = decideSlotAction(
      decisionInput(newSnapshot, {
        storedSlotState: stored,
        newestFollowupLogTimestampMs: spawnedAtMs + MINUTE_MS,
      }),
    );
    expect(decision.action).toBe(SlotWatchAction.RecordPendingSignal);
  });
});
