import { ProviderPrState } from "../guardrails/types.js";
import { ciRepairWaitRetryAt, isCiHeadAttempted } from "../pr-watch/attempts.js";
import { lastSeenEntryFor } from "../pr-watch/slotFiles.js";
import { CI_RED_RESPONSE_WINDOW_MS } from "../watch-qos/constants.js";
import { prReferenceOf } from "../watch-qos/identity.js";
import { WatchQosDetector, WatchQosHost, WatchQosSignal, type WatchQosObservation } from "../watch-qos/types.js";
import { isTerminalPrState } from "./pr-status.js";
import {
  CiRollupState,
  OwnerEscalationKind,
  WatcherLiveness,
  WatchFindingCode,
  WorkSessionAgent,
  type WatchQosTickInput,
  type WatchSlotAssessment,
  type WorkSession,
} from "./types.js";

const WATCHER_DOWN_FINDING_CODES: readonly WatchFindingCode[] = [WatchFindingCode.WatcherDead, WatchFindingCode.WatcherDeaf];

/** The telemetry host of every live session, by session id. */
export function watchQosHostsBySessionId(sessions: WorkSession[]): Map<string, WatchQosHost> {
  return new Map(
    sessions.map((session) => [
      session.sessionId,
      session.agent === WorkSessionAgent.Codex ? WatchQosHost.Codex : WatchQosHost.ClaudeCode,
    ]),
  );
}

function isCiRed(rollup: CiRollupState | undefined): boolean {
  return rollup === CiRollupState.Failure || rollup === CiRollupState.Error;
}

function prReferenceOfAssessment(assessment: WatchSlotAssessment): string {
  return prReferenceOf(assessment.pr.repo, assessment.pr.number);
}

/**
 * Whether the red head was acted on: a fix-ci cycle ran for it, a repair wait names it, or the watcher escalated it to
 * the owner. An escalation entry with no attempt behind it never counts, as everywhere else in the watch.
 */
function isRedHeadHandled(assessment: WatchSlotAssessment, headSha: string, lastSeenJson: string): boolean {
  const lastSeenEntry = lastSeenEntryFor(lastSeenJson, prReferenceOfAssessment(assessment));
  return (
    isCiHeadAttempted(lastSeenEntry, headSha) ||
    ciRepairWaitRetryAt(lastSeenEntry, headSha) !== undefined ||
    assessment.ownerEscalation?.kinds.includes(OwnerEscalationKind.Ci) === true
  );
}

function secondsBetween(fromMs: number, toMs: number): number {
  return Math.max(0, (toMs - fromMs) / 1000);
}

function watcherObservations(input: WatchQosTickInput, hostOf: (assessment: WatchSlotAssessment) => WatchQosHost): WatchQosObservation[] {
  const assessmentBySubject = new Map(input.assessments.map((assessment) => [prReferenceOfAssessment(assessment), assessment]));
  const observations: WatchQosObservation[] = [];
  const nowIso = new Date(input.nowMs).toISOString();
  for (const raised of input.transitions.raised) {
    const assessment = assessmentBySubject.get(raised.subject);
    if (!WATCHER_DOWN_FINDING_CODES.includes(raised.code) || !assessment) continue;
    observations.push({
      signal: WatchQosSignal.WatcherDown,
      detector: WatchQosDetector.WatchService,
      prReference: raised.subject,
      delaySeconds: assessment.heartbeatAgeMs === undefined ? undefined : assessment.heartbeatAgeMs / 1000,
      host: hostOf(assessment),
      occurrenceKey: `${raised.key}@${nowIso}`,
    });
  }
  for (const { key, record } of input.transitions.cleared) {
    const assessment = assessmentBySubject.get(record.subject);
    if (!WATCHER_DOWN_FINDING_CODES.includes(record.code) || !assessment?.live || isTerminalPrState(assessment.live.state)) continue;
    if (assessment.watcher === WatcherLiveness.Dead || assessment.watcher === WatcherLiveness.Deaf) continue;
    const downSinceMs = Date.parse(record.firstSeenAt);
    observations.push({
      signal: WatchQosSignal.WatcherRecovered,
      detector: WatchQosDetector.WatchService,
      prReference: record.subject,
      delaySeconds: Number.isFinite(downSinceMs) ? secondsBetween(downSinceMs, input.nowMs) : undefined,
      host: hostOf(assessment),
      occurrenceKey: `${key}@${record.firstSeenAt}`,
    });
  }
  return observations;
}

function openRedHeadObservations(
  assessment: WatchSlotAssessment,
  headSha: string,
  input: WatchQosTickInput,
  host: WatchQosHost,
): WatchQosObservation[] {
  const prReference = prReferenceOfAssessment(assessment);
  const redHead = { detector: WatchQosDetector.WatchService, prReference: prReference, headSha: headSha, host: host };
  const observations: WatchQosObservation[] = [{ ...redHead, signal: WatchQosSignal.CiRedObserved }];
  const redSinceMs = input.ciRedObservedAtMs(prReference, headSha) ?? input.nowMs;
  const redForSeconds = secondsBetween(redSinceMs, input.nowMs);
  if (isRedHeadHandled(assessment, headSha, input.lastSeenJsonBySlotDir.get(assessment.slotDir) ?? "")) {
    observations.push({ ...redHead, signal: WatchQosSignal.CiRedHandled, delaySeconds: redForSeconds });
  } else if (input.nowMs - redSinceMs > CI_RED_RESPONSE_WINDOW_MS) {
    observations.push({ ...redHead, signal: WatchQosSignal.CiRedLate, delaySeconds: redForSeconds });
  }
  return observations;
}

// Only a status fetched this tick carries the head and its checks; a PR the terminal cache answers was judged on the
// tick that first saw it terminal.
function terminalRedHeadObservations(
  assessment: WatchSlotAssessment,
  headSha: string,
  input: WatchQosTickInput,
  host: WatchQosHost,
): WatchQosObservation[] {
  if (isRedHeadHandled(assessment, headSha, input.lastSeenJsonBySlotDir.get(assessment.slotDir) ?? "")) return [];
  return [
    {
      signal: assessment.live?.state === ProviderPrState.Merged ? WatchQosSignal.MergedRed : WatchQosSignal.ClosedRed,
      detector: WatchQosDetector.WatchService,
      prReference: prReferenceOfAssessment(assessment),
      headSha: headSha,
      host: host,
    },
  ];
}

/**
 * What the watch service observed about watch quality this tick:
 * - `watcher-down` / `watcher-recovered` when a dead or deaf watcher finding is raised, or clears while its PR is still
 *   open and its watcher is heard again — with the heartbeat age, or the time it was down;
 * - for an open PR whose checks are red: `ci-red-observed`, then `ci-red-handled` once a fix attempt, repair wait or
 *   owner escalation covers the head, or `ci-red-late` once the response window passed with none;
 * - for a PR that merged or closed with its last head red and nothing covering it: `merged-red` / `closed-red`.
 *
 * Repeats across ticks are left to the ledger's dedup.
 */
export function deriveWatchQosObservations(input: WatchQosTickInput): WatchQosObservation[] {
  const hostOf = (assessment: WatchSlotAssessment): WatchQosHost =>
    (assessment.ownerSessionId === undefined ? undefined : input.hostBySessionId.get(assessment.ownerSessionId)) ??
    WatchQosHost.ClaudeCode;
  const observations = watcherObservations(input, hostOf);
  for (const assessment of input.assessments) {
    const live = assessment.live;
    if (!live?.headSha || !isCiRed(live.ciRollup)) continue;
    observations.push(
      ...(isTerminalPrState(live.state)
        ? terminalRedHeadObservations(assessment, live.headSha, input, hostOf(assessment))
        : openRedHeadObservations(assessment, live.headSha, input, hostOf(assessment))),
    );
  }
  return observations;
}
