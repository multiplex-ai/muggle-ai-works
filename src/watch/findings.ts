import { WATCH_HEARTBEAT_STALE_MS } from "../guardrails/constants.js";
import { ProviderPrState } from "../guardrails/types.js";
import { MONITOR_STDOUT_CAP_MS, WATCH_FINDING_SEVERITY, WATCHER_REARM_GRACE_MS } from "./constants.js";
import { formatDuration, shortSessionId, shortSha } from "./format.js";
import {
  CiRollupState,
  PrMergeable,
  PrMergeStateStatus,
  TrackedProcessKind,
  WatcherLiveness,
  WatchFindingCode,
  type FindingTransitions,
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
 * even under a live Monitor). A loop older than the Monitor's stdout cap, or one
 * whose owning session has ended, prints into a pipe nobody reads. With no
 * process table the heartbeat is the only signal left.
 */
export function resolveWatcherLiveness(
  loop: TrackedProcess | undefined,
  heartbeatAgeMs: number | undefined,
  isOwnerSessionActive: boolean | undefined,
  isProcessTableKnown: boolean,
): WatcherLiveness {
  const isHeartbeatWithin = (windowMs: number): boolean => heartbeatAgeMs !== undefined && heartbeatAgeMs <= windowMs;
  if (!isProcessTableKnown) {
    return isHeartbeatWithin(WATCH_HEARTBEAT_STALE_MS) ? WatcherLiveness.Polling : WatcherLiveness.Dead;
  }
  if (loop) {
    const hasOutlivedMonitor = (loop.ageMs ?? 0) > MONITOR_STDOUT_CAP_MS;
    return hasOutlivedMonitor || isOwnerSessionActive === false ? WatcherLiveness.Deaf : WatcherLiveness.Polling;
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
    const watcher = resolveWatcherLiveness(loop, heartbeatAgeMs, isOwnerSessionActive, processes !== null);
    for (const pr of slot.openPrs) {
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
        live: liveStatusesByUrl.get(pr.url),
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
  if (assessment.isOwnerSessionActive === true) {
    return `owner session ${owner} is running — run /muggle:muggle-pr-followup reconcile there`;
  }
  if (assessment.isOwnerSessionActive === false) {
    return assessment.isRegistered
      ? `owner session ${owner} has ended`
      : `owner session ${owner} has ended; slot is not registered for recovery`;
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
    const reason =
      assessment.isOwnerSessionActive === false
        ? `its owner session ${shortSessionId(assessment.ownerSessionId ?? "")} has ended`
        : `it has run ${formatDuration(assessment.loopAgeMs ?? 0)}, past the 30-minute Monitor cap`;
    return finding(WatchFindingCode.WatcherDeaf, [assessment.pr.url, assessment.loopPid], subject,
      `watch loop pid ${assessment.loopPid} reports to no session: ${reason}`);
  }
  return undefined;
}

function prStateFindings(assessment: WatchSlotAssessment, live: PrLiveStatus, subject: string): WatchFinding[] {
  const prFindings: WatchFinding[] = [];
  const head = shortSha(live.headSha);
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
    if (live && (live.state === ProviderPrState.Merged || live.state === ProviderPrState.Closed)) {
      findings.push(finding(WatchFindingCode.SlotTerminalUnfinalized, [assessment.pr.url], subject,
        `PR is ${live.state.toLowerCase()} but slot ${assessment.slug} is still open — reconcile finalizes it`));
      continue;
    }
    if (!live) {
      findings.push(finding(WatchFindingCode.PrStatusUnavailable, [assessment.pr.url], subject,
        `GitHub did not return this PR's status (watcher ${assessment.watcher})`));
      continue;
    }
    const watcherIssue = isPollingDisabled ? undefined : watcherFinding(assessment, subject);
    if (watcherIssue) findings.push(watcherIssue);
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
