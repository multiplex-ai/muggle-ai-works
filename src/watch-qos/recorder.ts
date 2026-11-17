import { WATCH_QOS_LEDGER_DISABLED_VALUE, WATCH_QOS_LEDGER_ENV_VAR } from "./constants.js";
import { hashWatchQosIdentity, resolveWatchQosSalt } from "./identity.js";
import { appendWatchQosRecord, findWatchQosRecord, resolveWatchQosPaths } from "./ledger.js";
import { WatchQosSignal, type WatchQosLedgerRecord, type WatchQosObservation, type WatchQosPaths } from "./types.js";

function isLedgerDisabled(): boolean {
  return process.env[WATCH_QOS_LEDGER_ENV_VAR] === WATCH_QOS_LEDGER_DISABLED_VALUE;
}

/** The ledger record an observation becomes: its PR and head hashed with this install's salt. */
export function toWatchQosLedgerRecord(observation: WatchQosObservation, salt: string, nowMs: number): WatchQosLedgerRecord {
  return {
    at: new Date(nowMs).toISOString(),
    signal: observation.signal,
    detector: observation.detector,
    subjectId: hashWatchQosIdentity(observation.prReference, salt),
    headId: observation.headSha ? hashWatchQosIdentity(observation.headSha, salt) : undefined,
    delaySeconds: observation.delaySeconds === undefined ? undefined : Math.max(0, Math.round(observation.delaySeconds)),
    host: observation.host,
    occurrenceKey: observation.occurrenceKey,
  };
}

/**
 * Record what a detector decided into the local ledger. Never sends anything and never throws: a hook or loop that
 * cannot write its record carries on exactly as before.
 *
 * @returns Whether a new record was written; false for a duplicate, a disabled ledger, or a failed write.
 */
export function recordWatchQosObservation(
  observation: WatchQosObservation,
  nowMs: number = Date.now(),
  paths: WatchQosPaths = resolveWatchQosPaths(),
): boolean {
  if (isLedgerDisabled()) return false;
  try {
    return appendWatchQosRecord(paths, toWatchQosLedgerRecord(observation, resolveWatchQosSalt(), nowMs));
  } catch {
    return false;
  }
}

/** When a head was first observed red, in epoch milliseconds; undefined when the ledger has no such record. */
export function ciRedObservedAtMs(
  prReference: string,
  headSha: string,
  paths: WatchQosPaths = resolveWatchQosPaths(),
): number | undefined {
  try {
    const salt = resolveWatchQosSalt();
    const observed = findWatchQosRecord(
      paths,
      WatchQosSignal.CiRedObserved,
      hashWatchQosIdentity(prReference, salt),
      hashWatchQosIdentity(headSha, salt),
    );
    const observedAtMs = observed ? Date.parse(observed.at) : NaN;
    return Number.isFinite(observedAtMs) ? observedAtMs : undefined;
  } catch {
    return undefined;
  }
}
