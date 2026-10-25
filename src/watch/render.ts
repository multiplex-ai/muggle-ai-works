import { formatDuration, shortSessionId } from "./format.js";
import {
  ReloadAction,
  TrackedProcessKind,
  WatchFindingSeverity,
  WorkSessionAgent,
  type WatchSlotAssessment,
  type WatchSnapshot,
  type WorkSession,
} from "./types.js";

const SEVERITY_ORDER = [WatchFindingSeverity.Alert, WatchFindingSeverity.Warning, WatchFindingSeverity.Notice];

function sessionLine(session: WorkSession): string {
  const host = session.agent === WorkSessionAgent.Codex ? "codex" : session.kind ?? "claude";
  const activity = [session.turnStatus, session.jobState].filter(Boolean).join("/") || "active";
  const label = session.name ? ` ${session.name}` : "";
  return `  ${host.padEnd(11)} ${activity.padEnd(15)} ${shortSessionId(session.sessionId)}${label}  ${session.cwd ?? ""}`.trimEnd();
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

/** `muggle watch status` text for a snapshot. */
export function renderWatchStatus(snapshot: WatchSnapshot, nowMs: number): string {
  const lines: string[] = [];
  const snapshotAgeMs = nowMs - Date.parse(snapshot.takenAt);
  lines.push(`Muggle Watch — last tick ${formatDuration(snapshotAgeMs)} ago (${snapshot.takenAt})`, "");

  const claudeCount = snapshot.sessions.filter((session) => session.agent === WorkSessionAgent.Claude).length;
  lines.push(`Sessions: ${claudeCount} Claude, ${snapshot.sessions.length - claudeCount} Codex`);
  lines.push(...snapshot.sessions.map(sessionLine), "");

  lines.push(`Processes: ${processSummary(snapshot)}`, "");

  lines.push(`PR watches: ${snapshot.slots.length} open`);
  lines.push(...snapshot.slots.map(slotLine), "");

  lines.push(`Findings: ${snapshot.findings.length}`);
  for (const severity of SEVERITY_ORDER) {
    for (const current of snapshot.findings.filter((candidate) => candidate.severity === severity)) {
      lines.push(`  ${severity.toUpperCase().padEnd(8)} ${current.subject.padEnd(44)} ${current.code}  ${current.message}`);
    }
  }

  if (snapshot.recoveries.length > 0) {
    lines.push("", "Recoveries:");
    for (const recovery of snapshot.recoveries) {
      lines.push(`  session ${shortSessionId(recovery.ownerSessionId)}  ${recovery.outcome}  ${recovery.slotSlugs.join(", ")}`);
    }
  }

  if (snapshot.reload) {
    const countOf = (action: ReloadAction): number =>
      snapshot.reload?.decisions.filter((decision) => decision.action === action).length ?? 0;
    lines.push(
      "",
      `Plugin reload: ${snapshot.reload.respawnedSessionIds.length} respawned, ${snapshot.reload.failedSessionIds.length} failed, ` +
        `${countOf(ReloadAction.Defer)} deferred, ${countOf(ReloadAction.NotifyManual)} need /reload-plugins by hand`,
    );
  }
  return `${lines.join("\n")}\n`;
}
