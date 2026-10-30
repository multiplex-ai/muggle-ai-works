import { WATCH_HEARTBEAT_STALE_MS } from "../guardrails/constants.js";
import { ProviderPrState } from "../guardrails/types.js";
import { WATCH_FINDING_SEVERITY, WATCHER_REARM_GRACE_MS } from "./constants.js";
import { formatDuration, shortSessionId, shortSha } from "./format.js";
import { resolveOwnerEscalation } from "./owner-escalation.js";
import { isTerminalPrState } from "./pr-status.js";
import { composeOwnerWakePrompt } from "./recovery.js";
import { isOwnerWakeReport } from "./service-loop.js";
import {
  CiRollupState,
  PrMergeable,
  PrMergeStateStatus,
  TrackedProcessKind,
  WatcherLiveness,
  WatchFindingCode,
  type FindingTransitions,
  type OwnerEscalation,
  type PrLiveStatus,
  type RepoCoverage,
  type TrackedProcess,
  type WatchFinding,
  type WatchLedgerState,
  type WatchSlotAssessment,
  type WatchSlotRecord,
} from "./types.js";

/**
 * Whether a slot's loop is heard.
 *
 * The loop is found by its `--slot` argument, never by `watch.pid` (an MSYS pid
 * Node cannot probe) or by its parent (Git Bash's exec breaks the Windows chain
 * even under a live Monitor). A loop a session armed prints into that session,
 * so once the session has ended it prints into a pipe nobody reads; a loop the
 * watch started writes to its slot, where the watch reads it whatever became of
 * the owner. Age alone says nothing: the loop has no read cap and runs for as
 * long as its PR stays quiet. With no process table the heartbeat is the only
 * signal left.
 */
export function resolveWatcherLiveness(
  loop: TrackedProcess | undefined,
  heartbeatAgeMs: number | undefined,
  isOwnerSessionActive: boolean | undefined,
  isProcessTableKnown: boolean,
  isHeardByService = false,
): WatcherLiveness {
  const isHeartbeatWithin = (windowMs: number): boolean => heartbeatAgeMs !== undefined && heartbeatAgeMs <= windowMs;
  if (!isProcessTableKnown) {
    return isHeartbeatWithin(WATCH_HEARTBEAT_STALE_MS) ? WatcherLiveness.Polling : WatcherLiveness.Dead;
  }
  if (loop) {
    return isOwnerSessionActive === false && !isHeardByService ? WatcherLiveness.Deaf : WatcherLiveness.Polling;
  }
  return isHeartbeatWithin(WATCHER_REARM_GRACE_MS) ? WatcherLiveness.Rearming : WatcherLiveness.Dead;
}

// MSYS forks a short-lived bash per `$(…)`, each carrying the loop's command
// line, so one slot can show several matches; the oldest is the loop itself.
function oldestLoopFor(slug: string, processes: TrackedProcess[]): TrackedProcess | undefined {
  return processes
    .filter((tracked) => tracked.kind === TrackedProcessKind.PrWatchLoop && tracked.watchSlotSlug === slug)
    .sort((left, right) => (right.ageMs ?? 0) - (left.ageMs ?? 0))[0];
}

/**
 * One assessment per open PR per slot.
 *
 * @param processes - Tracked processes, or null when the process table could not be read.
 * @param activeSessionIds - Every active Claude and Codex session id, or null when unknown.
 */
export function assessWatchSlots(
  slots: WatchSlotRecord[],
  processes: TrackedProcess[] | null,
  activeSessionIds: Set<string> | null,
  liveStatusesByUrl: Map<string, PrLiveStatus>,
  nowMs: number,
): WatchSlotAssessment[] {
  const assessments: WatchSlotAssessment[] = [];
  for (const slot of slots) {
    const loop = processes ? oldestLoopFor(slot.slug, processes) : undefined;
    const heartbeatAgeMs = slot.heartbeatMtimeMs === undefined ? undefined : Math.max(0, nowMs - slot.heartbeatMtimeMs);
    const isOwnerSessionActive =
      slot.ownerSessionId === undefined || activeSessionIds === null ? undefined : activeSessionIds.has(slot.ownerSessionId);
    const watcher = resolveWatcherLiveness(loop, heartbeatAgeMs, isOwnerSessionActive, processes !== null, slot.isHeardByService);
    const reportAgeMs = slot.serviceLoopReport === undefined ? undefined : Math.max(0, nowMs - slot.serviceLoopReport.writtenAtMs);
    for (const pr of slot.openPrs) {
      const live = liveStatusesByUrl.get(pr.url);
      assessments.push({
        slug: slot.slug,
        slotDir: slot.slotDir,
        pr: pr,
        isRegistered: slot.isRegistered,
        watcher: watcher,
        loopPid: loop?.pid,
        loopAgeMs: loop?.ageMs,
        heartbeatAgeMs: heartbeatAgeMs,
        ownerSessionId: slot.ownerSessionId,
        isOwnerSessionActive: isOwnerSessionActive,
        live: live,
        ownerEscalation: resolveOwnerEscalation(slot.lastSeenJson, slot.followupLogLines, pr, live?.headSha),
        isHeardByService: slot.isHeardByService,
        serviceLoopReport: slot.serviceLoopReport,
        serviceLoopReportAgeMs: reportAgeMs,
      });
    }
  }
  return assessments;
}

function finding(code: WatchFindingCode, keyParts: Array<string | number | undefined>, subject: string, message: string): WatchFinding {
  return {
    key: [code, ...keyParts.map((part) => String(part ?? ""))].join(":"),
    code: code,
    severity: WATCH_FINDING_SEVERITY[code],
    subject: subject,
    message: message,
  };
}

function ownerPhrase(assessment: WatchSlotAssessment): string {
  if (assessment.ownerSessionId === undefined) {
    return `slot has no owner — adopt it with /muggle:muggle-pr-followup adopt ${assessment.slug}`;
  }
  const owner = shortSessionId(assessment.ownerSessionId);
  if (!assessment.isRegistered) {
    return `slot is not registered, so the watch leaves it to owner session ${owner}`;
  }
  if (assessment.isOwnerSessionActive === true) {
    return `owner session ${owner} is running — the watch restarts the loop once that session is between turns`;
  }
  if (assessment.isOwnerSessionActive === false) {
    return `owner session ${owner} has ended — the watch restarts the loop`;
  }
  return `owner session ${owner} could not be checked`;
}

function watcherFinding(assessment: WatchSlotAssessment, subject: string): WatchFinding | undefined {
  if (assessment.watcher === WatcherLiveness.Dead) {
    const heartbeat =
      assessment.heartbeatAgeMs === undefined ? "no heartbeat" : `heartbeat ${formatDuration(assessment.heartbeatAgeMs)} old`;
    return finding(WatchFindingCode.WatcherDead, [assessment.pr.url], subject,
      `no watch loop is running (${heartbeat}); ${ownerPhrase(assessment)}`);
  }
  if (assessment.watcher === WatcherLiveness.Deaf) {
    return finding(WatchFindingCode.WatcherDeaf, [assessment.pr.url, assessment.loopPid], subject,
      `watch loop pid ${assessment.loopPid} reports to no session: its owner session ${shortSessionId(assessment.ownerSessionId ?? "")} has ended`);
  }
  return undefined;
}

// A report is normally delivered the tick after its loop exits; one still
// waiting past the grace means its owner is busy, waiting on its user, or a
// terminal session the watch cannot wake, so the user hears about it instead.
function ownerWakeFinding(assessment: WatchSlotAssessment, subject: string): WatchFinding | undefined {
  const report = assessment.serviceLoopReport;
  if (!report || !isOwnerWakeReport(report) || assessment.watcher === WatcherLiveness.Polling) return undefined;
  if ((assessment.serviceLoopReportAgeMs ?? 0) <= WATCHER_REARM_GRACE_MS || assessment.ownerSessionId === undefined) return undefined;
  const command = composeOwnerWakePrompt(assessment.slug, assessment.pr.number, report.kind);
  return finding(WatchFindingCode.OwnerWakePending, [assessment.pr.url, report.writtenAtMs], subject,
    `${report.reportLines[0] ?? report.kind} — waiting for owner session ${shortSessionId(assessment.ownerSessionId)}; run ${command} there`);
}

function awaitingOwnerMessage(assessment: WatchSlotAssessment, escalation: OwnerEscalation, head: string): string {
  const owner =
    assessment.ownerSessionId === undefined ? "no owner session" : `owner session ${shortSessionId(assessment.ownerSessionId)}`;
  const handedOver = `watcher escalated ${escalation.kinds.join(", ")} on ${head} to ${owner}; a decision waits on you`;
  return escalation.note ? `${handedOver} — ${escalation.note}` : handedOver;
}

function prStateFindings(assessment: WatchSlotAssessment, live: PrLiveStatus, subject: string): WatchFinding[] {
  const prFindings: WatchFinding[] = [];
  const head = shortSha(live.headSha);
  // Ahead of the red CI it explains: a notification lists only its first few lines.
  const escalation = assessment.ownerEscalation;
  if (escalation) {
    prFindings.push(finding(WatchFindingCode.AwaitingOwner, [assessment.pr.url, live.headSha, escalation.kinds.join("+")], subject,
      awaitingOwnerMessage(assessment, escalation, head)));
  }
  if (live.ciRollup === CiRollupState.Failure || live.ciRollup === CiRollupState.Error) {
    prFindings.push(finding(WatchFindingCode.CiFailing, [assessment.pr.url, live.headSha], subject,
      `checks on ${head} are ${live.ciRollup.toLowerCase()}`));
  }
  if (live.mergeable === PrMergeable.Conflicting || live.mergeStateStatus === PrMergeStateStatus.Dirty) {
    prFindings.push(finding(WatchFindingCode.BaseConflict, [assessment.pr.url, live.headSha], subject,
      `head ${head} conflicts with its base — rebase due`));
  } else if (live.mergeStateStatus === PrMergeStateStatus.Behind) {
    prFindings.push(finding(WatchFindingCode.BehindBase, [assessment.pr.url, live.headSha], subject,
      `head ${head} is behind its base`));
  }
  if (live.unresolvedThreadCount > 0) {
    const threads = live.unresolvedThreadCount === 1 ? "thread" : "threads";
    prFindings.push(finding(WatchFindingCode.ReviewThreadsUnresolved, [assessment.pr.url], subject,
      `${live.unresolvedThreadCount} unresolved review ${threads}`));
  }
  return prFindings;
}

/**
 * Every condition worth reporting this tick. A watch is owed only to a PR GitHub
 * confirms open: a terminal PR reports only that its slot is unfinalized, and a
 * PR GitHub did not answer for reports only that — alerting on its watcher would
 * flag every merged PR's stopped loop whenever GitHub is unreachable.
 * `polling.disabled` silences the watcher findings, since the owner switched
 * the watchers off.
 */
export function deriveWatchFindings(
  assessments: WatchSlotAssessment[],
  processes: TrackedProcess[],
  isPollingDisabled: boolean,
): WatchFinding[] {
  const findings: WatchFinding[] = [];
  for (const assessment of assessments) {
    const subject = `${assessment.pr.repo}#${assessment.pr.number}`;
    const live = assessment.live;
    if (live && isTerminalPrState(live.state)) {
      findings.push(finding(WatchFindingCode.SlotTerminalUnfinalized, [assessment.pr.url], subject,
        `PR is ${live.state.toLowerCase()} but slot ${assessment.slug} is still open — its owner finalizes it, or the watch closes it out once the owner has ended`));
      continue;
    }
    if (!live) {
      findings.push(finding(WatchFindingCode.PrStatusUnavailable, [assessment.pr.url], subject,
        `GitHub did not return this PR's status (watcher ${assessment.watcher})`));
      continue;
    }
    const watcherIssue = isPollingDisabled ? undefined : watcherFinding(assessment, subject);
    if (watcherIssue) findings.push(watcherIssue);
    const pendingWake = isPollingDisabled ? undefined : ownerWakeFinding(assessment, subject);
    if (pendingWake) findings.push(pendingWake);
    findings.push(...prStateFindings(assessment, live, subject));
  }
  for (const tracked of processes) {
    if (tracked.kind !== TrackedProcessKind.MuggleMcpServer || tracked.isOrphaned !== true) continue;
    findings.push(finding(WatchFindingCode.OrphanedMcpServer, [tracked.pid], `pid ${tracked.pid}`,
      "muggle MCP server outlived the agent that launched it"));
  }
  return findings;
}

/**
 * Per repo, how many PRs GitHub confirms open are watched (a loop polling or
 * mid-rollover), deaf, or dead. PRs whose status is unknown or terminal owe no
 * watch, so they are left out.
 *
 * Output shape: `[{ repo: "o/r", watched: 3, deaf: 0, dead: 1 }]`
 */
export function computeCoverage(assessments: WatchSlotAssessment[]): RepoCoverage[] {
  const coverageByRepo = new Map<string, RepoCoverage>();
  for (const assessment of assessments) {
    if (assessment.live?.state !== ProviderPrState.Open) continue;
    const coverage = coverageByRepo.get(assessment.pr.repo) ?? { repo: assessment.pr.repo, watched: 0, deaf: 0, dead: 0 };
    if (assessment.watcher === WatcherLiveness.Dead) coverage.dead++;
    else if (assessment.watcher === WatcherLiveness.Deaf) coverage.deaf++;
    else coverage.watched++;
    coverageByRepo.set(assessment.pr.repo, coverage);
  }
  return [...coverageByRepo.values()].sort((left, right) => left.repo.localeCompare(right.repo));
}

/**
 * Carry the active findings forward: what is new this tick is raised, what is
 * gone is cleared, and a finding still present keeps its first-seen time.
 */
export function reconcileActiveFindings(
  previous: WatchLedgerState["activeFindings"],
  current: WatchFinding[],
  nowIso: string,
): FindingTransitions {
  const activeFindings: FindingTransitions["activeFindings"] = {};
  const raised: WatchFinding[] = [];
  for (const currentFinding of current) {
    const earlier = previous[currentFinding.key];
    if (!earlier) raised.push(currentFinding);
    activeFindings[currentFinding.key] = {
      code: currentFinding.code,
      severity: currentFinding.severity,
      subject: currentFinding.subject,
      message: currentFinding.message,
      firstSeenAt: earlier?.firstSeenAt ?? nowIso,
    };
  }
  const cleared = Object.entries(previous)
    .filter(([key]) => !(key in activeFindings))
    .map(([key, record]) => ({ key: key, record: record }));
  return { activeFindings: activeFindings, raised: raised, cleared: cleared };
}
