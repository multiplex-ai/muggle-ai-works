import { REMOTE_CONTROL_NAME_COLUMN_WIDTH } from "./constants.js";
import { formatDuration, shortSessionId } from "./format.js";
import {
  LimitResumeAction,
  ReloadAction,
  TrackedProcessKind,
  WatcherRecoveryOutcome,
  WatchFindingSeverity,
  WorkSessionAgent,
  type ReloadReport,
  type RepoCoverage,
  type WatchSlotAssessment,
  type WatchSnapshot,
  type WorkSession,
} from "./types.js";

const SEVERITY_ORDER = [WatchFindingSeverity.Alert, WatchFindingSeverity.Warning, WatchFindingSeverity.Notice];

// A session with no known load time is not counted behind: the watch cannot tell.
function isBehind(session: WorkSession, installedVersion: string | undefined): boolean {
  return installedVersion !== undefined && session.loadedAtMs !== undefined && session.loadedVersion !== installedVersion;
}

function sessionLine(session: WorkSession, installedVersion: string | undefined): string {
  const host = session.agent === WorkSessionAgent.Codex ? "codex" : session.kind ?? "claude";
  const activity = [session.turnStatus, session.jobState].filter(Boolean).join("/") || "active";
  const label = session.name ? ` ${session.name}` : "";
  const build = isBehind(session, installedVersion) ? `  [behind: ${session.loadedVersion ?? "older than the install log"}]` : "";
  return `  ${host.padEnd(11)} ${activity.padEnd(15)} ${shortSessionId(session.sessionId)}${label}${build}  ${session.cwd ?? ""}`.trimEnd();
}

function ownerLabel(slot: WatchSlotAssessment): string {
  if (!slot.ownerSessionId) return "no owner";
  const ownerState = slot.isOwnerSessionActive === undefined ? "unknown" : slot.isOwnerSessionActive ? "active" : "ended";
  return `owner ${shortSessionId(slot.ownerSessionId)} (${ownerState})`;
}

function slotLine(slot: WatchSlotAssessment): string {
  const live = slot.live;
  const githubState = live
    ? [live.state.toLowerCase(), live.ciRollup ? `ci ${live.ciRollup.toLowerCase()}` : "", live.mergeStateStatus?.toLowerCase() ?? ""]
        .filter(Boolean)
        .join(", ")
    : "status unavailable";
  const registration = slot.isRegistered ? "registered" : "unregistered";
  return `  ${`${slot.pr.repo}#${slot.pr.number}`.padEnd(44)} ${slot.watcher.padEnd(9)} ${registration.padEnd(12)} ${ownerLabel(slot)}  ${githubState}`;
}

function processSummary(snapshot: WatchSnapshot): string {
  const countOf = (kind: TrackedProcessKind): number => snapshot.processes.filter((tracked) => tracked.kind === kind).length;
  const orphanedServers = snapshot.processes.filter(
    (tracked) => tracked.kind === TrackedProcessKind.MuggleMcpServer && tracked.isOrphaned === true,
  ).length;
  return [
    `${countOf(TrackedProcessKind.ClaudeCli)} claude`,
    `${countOf(TrackedProcessKind.CodexCli)} codex`,
    `${countOf(TrackedProcessKind.MuggleMcpServer)} muggle MCP servers (${orphanedServers} orphaned)`,
    `${countOf(TrackedProcessKind.PrWatchLoop)} PR watch loop processes`,
  ].join(", ");
}

function countDecisions(report: ReloadReport, action: ReloadAction): number {
  return report.decisions.filter((decision) => decision.action === action).length;
}

/** `muggle watch status` text for a snapshot. */
export function renderWatchStatus(snapshot: WatchSnapshot, nowMs: number): string {
  const lines: string[] = [];
  const snapshotAgeMs = nowMs - Date.parse(snapshot.takenAt);
  lines.push(`Muggle Watch — last tick ${formatDuration(snapshotAgeMs)} ago (${snapshot.takenAt})`, "");

  const claudeCount = snapshot.sessions.filter((session) => session.agent === WorkSessionAgent.Claude).length;
  const behindCount = snapshot.sessions.filter((session) => isBehind(session, snapshot.installedVersion)).length;
  const drift = snapshot.installedVersion ? ` (${behindCount} behind installed ${snapshot.installedVersion})` : "";
  lines.push(`Sessions: ${claudeCount} Claude${drift}, ${snapshot.sessions.length - claudeCount} Codex`);
  lines.push(...snapshot.sessions.map((session) => sessionLine(session, snapshot.installedVersion)), "");

  lines.push(`Processes: ${processSummary(snapshot)}`, "");

  lines.push(`PR watches: ${snapshot.slots.length} open`);
  lines.push(...snapshot.slots.map(slotLine), "");

  // A snapshot an earlier release wrote has no coverage or close-outs until the next tick replaces it.
  const coverage = snapshot.coverage ?? [];
  const sumOf = (pick: (repoCoverage: RepoCoverage) => number): number => coverage.reduce((total, repoCoverage) => total + pick(repoCoverage), 0);
  lines.push(`Coverage of open PRs: ${sumOf((repoCoverage) => repoCoverage.watched)} watched, ${sumOf((repoCoverage) => repoCoverage.deaf)} deaf, ${sumOf((repoCoverage) => repoCoverage.dead)} dead`);
  for (const repoCoverage of coverage) {
    lines.push(`  ${repoCoverage.repo.padEnd(44)} watched ${repoCoverage.watched}  deaf ${repoCoverage.deaf}  dead ${repoCoverage.dead}`);
  }
  if ((snapshot.closedOutSlugs ?? []).length > 0) {
    lines.push(`Closed out this tick (PR merged or closed, nobody watching): ${snapshot.closedOutSlugs.join(", ")}`);
  }
  lines.push("");

  lines.push(`Findings: ${snapshot.findings.length}`);
  for (const severity of SEVERITY_ORDER) {
    for (const current of snapshot.findings.filter((candidate) => candidate.severity === severity)) {
      lines.push(`  ${severity.toUpperCase().padEnd(8)} ${current.subject.padEnd(44)} ${current.code}  ${current.message}`);
    }
  }

  const serviceArms = snapshot.serviceArms ?? [];
  if (serviceArms.length > 0) {
    lines.push("", "Watch loops started by the watch:");
    for (const serviceArm of serviceArms) {
      lines.push(`  ${serviceArm.slug.padEnd(44)} ${serviceArm.outcome}`);
    }
  }

  if (snapshot.recoveries.length > 0) {
    lines.push("", "Owner wakes:");
    for (const recovery of snapshot.recoveries) {
      lines.push(`  session ${shortSessionId(recovery.ownerSessionId)}  ${recovery.outcome}  ${recovery.slotSlug} PR #${recovery.prNumber} (${recovery.reportKind})`);
    }
  }

  if (snapshot.reload) {
    const reload = snapshot.reload;
    lines.push(
      "",
      `Plugin reload: ${reload.respawnedSessionIds.length} restarted, ${reload.failedSessionIds.length} failed, ` +
        `${countDecisions(reload, ReloadAction.Defer)} deferred, ${countDecisions(reload, ReloadAction.NotifyManual) + (reload.untrustedSessionIds?.length ?? 0)} need /reload-plugins by hand`,
    );
  }

  if (snapshot.remoteControl) {
    const remoteControl = snapshot.remoteControl;
    lines.push(
      "",
      `Remote Control: ${remoteControl.connectedSessionIds.length} connected, ${remoteControl.respawnedSessionIds.length} restarted, ` +
        `${remoteControl.failedSessionIds.length} failed, ${remoteControl.untrustedSessionIds.length} refused, ` +
        `${countDecisions(remoteControl, ReloadAction.Defer)} waiting, ` +
        `${countDecisions(remoteControl, ReloadAction.Skip) + countDecisions(remoteControl, ReloadAction.NotifyManual)} skipped`,
    );
    for (const decision of remoteControl.decisions) {
      const outcome = remoteControl.untrustedSessionIds.includes(decision.sessionId)
        ? " — refused: its workspace takes no background restart, run /remote-control in it"
        : remoteControl.failedSessionIds.includes(decision.sessionId)
          ? " — restart failed"
          : "";
      const label = (decision.name ?? "").slice(0, REMOTE_CONTROL_NAME_COLUMN_WIDTH).padEnd(REMOTE_CONTROL_NAME_COLUMN_WIDTH);
      lines.push(`  ${decision.action.padEnd(14)} ${shortSessionId(decision.sessionId)} ${label} ${decision.reason}${outcome}`);
    }
  }

  const limitDecisions = snapshot.limitResumes?.decisions ?? [];
  if (limitDecisions.length > 0) {
    const countOutcome = (outcome: WatcherRecoveryOutcome): number => limitDecisions.filter((decision) => decision.outcome === outcome).length;
    const countAction = (action: LimitResumeAction): number => limitDecisions.filter((decision) => decision.action === action).length;
    const continueCount = countAction(LimitResumeAction.Continue);
    const continuedCount = countOutcome(WatcherRecoveryOutcome.Resumed);
    lines.push(
      "",
      `Stopped at a usage limit: ${continuedCount} continued, ${continueCount - continuedCount} failed, ` +
        `${countAction(LimitResumeAction.Wait)} waiting, ${countAction(LimitResumeAction.Skip)} skipped`,
    );
    for (const decision of limitDecisions) {
      const outcome = decision.outcome === undefined || decision.outcome === WatcherRecoveryOutcome.Resumed ? "" : ` — ${decision.outcome}`;
      const label = (decision.name ?? "").slice(0, REMOTE_CONTROL_NAME_COLUMN_WIDTH).padEnd(REMOTE_CONTROL_NAME_COLUMN_WIDTH);
      lines.push(`  ${decision.action.padEnd(14)} ${shortSessionId(decision.sessionId)} ${label} ${decision.reason}${outcome}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
