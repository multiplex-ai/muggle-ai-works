import { hasSpawnSignal } from "./signature.js";
import {
  SlotDecision,
  SlotDecisionInput,
  SlotSkipReason,
  SlotWatchAction,
  SpawnTickReason,
  WatchdogSlotState,
} from "./types.js";

export function emptyWatchdogSlotState(): WatchdogSlotState {
  return {
    pending_signature: null,
    pending_seen_at: null,
    last_spawn_signature: null,
    last_spawn_at: null,
    spawn_attempts: 0,
  };
}

function skip(skipReason: SlotSkipReason, updatedSlotState?: WatchdogSlotState): SlotDecision {
  return { action: SlotWatchAction.Skip, skipReason: skipReason, updatedSlotState: updatedSlotState };
}

function spawn(
  spawnReason: SpawnTickReason,
  input: SlotDecisionInput,
): SlotDecision {
  const updatedSlotState: WatchdogSlotState = {
    pending_signature: null,
    pending_seen_at: null,
    last_spawn_signature: input.signature,
    last_spawn_at: new Date(input.nowMs).toISOString(),
    spawn_attempts: input.storedSlotState.spawn_attempts + 1,
  };
  return { action: SlotWatchAction.SpawnTick, spawnReason: spawnReason, updatedSlotState: updatedSlotState };
}

/**
 * One slot's recovery verdict for one scan. Precedence: a live watcher or an
 * in-flight cycle owns the PR; no signal clears any pending record; a
 * signature already spawned is retried only while unconfirmed (the
 * limit-reset path) and never after a tick demonstrably ran; a terminal PR
 * spawns immediately; any other signal must survive two consecutive scans
 * before it spawns, giving a live-but-unheard watcher first claim.
 */
export function decideSlotAction(input: SlotDecisionInput): SlotDecision {
  const stored = input.storedSlotState;

  if (input.isWatcherLive) return skip(SlotSkipReason.WatcherLive);
  if (input.isCycleInProgress) return skip(SlotSkipReason.CycleInProgress);

  if (!hasSpawnSignal(input.pollSnapshot)) {
    if (stored.pending_signature === null) return skip(SlotSkipReason.NoSignal);
    return skip(SlotSkipReason.NoSignal, { ...stored, pending_signature: null, pending_seen_at: null });
  }

  if (stored.last_spawn_signature === input.signature && stored.last_spawn_at !== null) {
    const lastSpawnMs = Date.parse(stored.last_spawn_at);
    // Terminal completion is the finalize itself — result.md removes the slot
    // from the open set. A log line alone proves nothing for terminal (a tick
    // killed mid-finalize logs but leaves the slot open), so terminal spawns
    // stay retry-eligible for as long as the slot exists.
    const tickRanAfterSpawn =
      input.pollSnapshot.prState === "OPEN" &&
      input.newestFollowupLogTimestampMs !== null &&
      input.newestFollowupLogTimestampMs > lastSpawnMs;
    if (tickRanAfterSpawn) return skip(SlotSkipReason.AlreadyHandled);
    if (input.nowMs - lastSpawnMs < input.spawnRetryAfterMs) {
      return skip(SlotSkipReason.AwaitingSpawnRetryWindow);
    }
    return spawn(SpawnTickReason.SpawnRetry, input);
  }

  if (input.pollSnapshot.prState !== "OPEN") return spawn(SpawnTickReason.TerminalPr, input);

  if (stored.pending_signature !== input.signature || stored.pending_seen_at === null) {
    const updatedSlotState: WatchdogSlotState = {
      ...stored,
      pending_signature: input.signature,
      pending_seen_at: new Date(input.nowMs).toISOString(),
    };
    return { action: SlotWatchAction.RecordPendingSignal, updatedSlotState: updatedSlotState };
  }

  if (input.nowMs - Date.parse(stored.pending_seen_at) >= input.confirmSignalAfterMs) {
    return spawn(SpawnTickReason.ConfirmedSignal, input);
  }
  return skip(SlotSkipReason.AwaitingSignalConfirmation);
}
