import { watchQosHostOfHookHost } from "../watch-qos/host.js";
import { prReferenceOfUrl } from "../watch-qos/identity.js";
import { ciRedObservedAtMs, recordWatchQosObservation } from "../watch-qos/recorder.js";
import { WatchQosDetector, WatchQosSignal } from "../watch-qos/types.js";
import type { Host } from "./emit.js";
import { OwedWatchWorkKind, type OwedWatchWork } from "./types.js";

function recordTurnEndSignal(signal: WatchQosSignal, prUrls: string[], host: Host): void {
  for (const prUrl of prUrls) {
    recordWatchQosObservation({
      signal: signal,
      detector: WatchQosDetector.TurnEndGate,
      prReference: prReferenceOfUrl(prUrl),
      host: watchQosHostOfHookHost(host),
    });
  }
}

/** A PR the session handled for the first time: the watch-miss denominator, and a skip when one already covers the session. */
export function recordPrOpenedWatchQos(prUrl: string, host: Host, isWatchSkipped: boolean): void {
  recordTurnEndSignal(WatchQosSignal.PrOpened, [prUrl], host);
  if (isWatchSkipped) recordTurnEndSignal(WatchQosSignal.WatchSkipped, [prUrl], host);
}

/** The watch gate gave up on these PRs: the turn ended past its block budget with each still unwatched. */
export function recordWatchMissedWatchQos(unwatchedPrUrls: string[], host: Host): void {
  recordTurnEndSignal(WatchQosSignal.WatchMissed, unwatchedPrUrls, host);
}

/** The owner declared `MUGGLE_WATCH_SKIP` while these PRs were unwatched: a skip, never a miss. */
export function recordWatchSkippedWatchQos(unwatchedPrUrls: string[], host: Host): void {
  recordTurnEndSignal(WatchQosSignal.WatchSkipped, unwatchedPrUrls, host);
}

/**
 * The follow-through gate had to force a fix the watch had already reported: one record per red head, with the time
 * since the head was first observed red when the ledger has it.
 */
export function recordCiCaughtAtTurnEndWatchQos(owedWork: OwedWatchWork[], host: Host, nowMs: number = Date.now()): void {
  for (const work of owedWork) {
    if (work.kind !== OwedWatchWorkKind.FixCi) continue;
    const prReference = prReferenceOfUrl(work.prUrl);
    const observedAtMs = ciRedObservedAtMs(prReference, work.dueOn);
    recordWatchQosObservation(
      {
        signal: WatchQosSignal.CiRedCaughtAtTurnEnd,
        detector: WatchQosDetector.FollowThroughGate,
        prReference: prReference,
        headSha: work.dueOn,
        delaySeconds: observedAtMs === undefined ? undefined : (nowMs - observedAtMs) / 1000,
        host: watchQosHostOfHookHost(host),
      },
      nowMs,
    );
  }
}
