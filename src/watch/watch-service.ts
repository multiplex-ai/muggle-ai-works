import { resolve } from "path";
import { PreferenceValue } from "../../packages/mcps/src/shared/preferences-types.js";
import { ProviderPrState } from "../guardrails/types.js";
import { readClaudeSessions } from "./claude-sessions.js";
import { readCodexSessions } from "./codex-sessions.js";
import { defaultCommandRunner } from "./command-runner.js";
import { WATCH_CRONTAB_LINE, WATCH_NOTIFICATION_TITLE, WATCH_REGISTRATION_SOURCE_CLI } from "./constants.js";
import { assessWatchSlots, computeCoverage, deriveWatchFindings, reconcileActiveFindings } from "./findings.js";
import { shortSessionId } from "./format.js";
import { readInstallHistory } from "./install-history.js";
import {
  appendWatchEvents,
  readWatchLedgerState,
  readWatchSnapshot,
  withWatchLock,
  writeWatchLedgerState,
  writeWatchSnapshot,
} from "./ledger.js";
import { composeTickNotification, createDesktopNotifier } from "./notify.js";
import { resolveWatchPaths } from "./paths.js";
import { readUserPluginsUpdatedAtMs } from "./plugins-updated.js";
import { fetchPrLiveStatuses } from "./pr-status.js";
import { readProcessTable } from "./process-table.js";
import { executeWatcherRecoveries, isSlotCloseOutDue, planWatcherRecoveries } from "./recovery.js";
import { advancePendingReload, executeReloadFanOut, planReloadFanOut } from "./reload-plugins.js";
import { findWatchInstallerScript, isWatchTaskRegistered, runWatchInstaller } from "./service-installer.js";
import { resolveReloadTargetAtMs, stampSessionLoads } from "./session-drift.js";
import { partitionByTerminalCache, updateTerminalCache } from "./terminal-pr-cache.js";
import { classifyTrackedProcesses } from "./tracked-processes.js";
import {
  closeOutWatchSlot,
  isPrPollingDisabled,
  readOpenWatchSlots,
  removeSlotRegistration,
  writeSlotRegistration,
} from "./watch-slots.js";
import { canRestartSessionIn } from "./workspace-trust.js";
import {
  WatchEventKind,
  WatchServiceInstallOutcome,
  type InstallRecord,
  type PendingReload,
  type ReloadReport,
  type TrackedProcess,
  type WatcherRecovery,
  type WatchEvent,
  type WatchLedgerState,
  type WatchPaths,
  type WatchServiceInstallDeps,
  type WatchServiceInstallReport,
  type WatchSlotAssessment,
  type WatchSnapshot,
  type WatchTickDeps,
  type WorkSession,
} from "./types.js";

/** The real edges: this machine's processes, sessions, `gh`, `claude` and desktop notifications. */
export function createDefaultWatchTickDeps(options: { isAutoReloadEnabled: boolean; isRecoveryEnabled: boolean }): WatchTickDeps {
  return {
    nowMs: Date.now(),
    platform: process.platform,
    paths: resolveWatchPaths(),
    runCommand: defaultCommandRunner,
    notify: createDesktopNotifier(process.platform, defaultCommandRunner),
    isAutoReloadEnabled: options.isAutoReloadEnabled,
    isRecoveryEnabled: options.isRecoveryEnabled,
  };
}

/** The real edges a watch-service install needs: this platform and its Task Scheduler. */
export function createDefaultWatchServiceInstallDeps(): WatchServiceInstallDeps {
  return { platform: process.platform, runCommand: defaultCommandRunner };
}

function notifyIfAny(deps: WatchTickDeps, lines: string[]): void {
  if (lines.length > 0) deps.notify(WATCH_NOTIFICATION_TITLE, lines);
}

function lockedOrThrow<T>(watchDir: string, run: () => T): T {
  const outcome = withWatchLock(watchDir, run);
  if (outcome === undefined) throw new Error("another muggle watch run holds the lock — try again shortly");
  return outcome;
}

/** Live processes and sessions, each Claude session stamped with the build it loaded. */
function observeSessions(deps: WatchTickDeps, installs: InstallRecord[]): {
  processes: TrackedProcess[] | null;
  claudeSessions: WorkSession[] | null;
  sessions: WorkSession[];
} {
  const table = readProcessTable(deps.platform, deps.runCommand, deps.nowMs);
  const processes = table ? classifyTrackedProcesses(table, deps.platform) : null;
  const listedSessions = readClaudeSessions(deps.runCommand, deps.paths.claudeSessionRegistryDir);
  const claudeSessions =
    listedSessions && table && processes ? stampSessionLoads(listedSessions, table, processes, installs, deps.nowMs) : listedSessions;
  const sessions = [...(claudeSessions ?? []), ...readCodexSessions(deps.paths.codexSessionsDir, deps.nowMs)];
  return { processes: processes, claudeSessions: claudeSessions, sessions: sessions };
}

function watchOwnersOf(slots: WatchSlotAssessment[]): Set<string> {
  return new Set(slots.flatMap((slot) => (slot.live?.state === ProviderPrState.Open && slot.ownerSessionId ? [slot.ownerSessionId] : [])));
}

function reloadEvents(report: ReloadReport, at: string): WatchEvent[] {
  const decisionById = new Map(report.decisions.map((decision) => [decision.sessionId, decision]));
  const describe = (sessionId: string): string => `session ${decisionById.get(sessionId)?.name ?? shortSessionId(sessionId)}`;
  return [
    ...report.respawnedSessionIds.map((sessionId) => ({ at: at, kind: WatchEventKind.Respawned, subject: describe(sessionId) })),
    ...report.failedSessionIds.map((sessionId) => ({ at: at, kind: WatchEventKind.RespawnFailed, subject: describe(sessionId) })),
    ...report.untrustedSessionIds.map((sessionId) => ({
      at: at,
      kind: WatchEventKind.RestartRefused,
      subject: describe(sessionId),
      message: `workspace ${decisionById.get(sessionId)?.cwd ?? "?"} refuses a background restart`,
    })),
  ];
}

// The record is kept per target build, so a session handled once for a build —
// restarted, told to reload, or found unrestartable — is never tried again for it.
// A record an earlier release wrote lacks the newer lists, hence the defaults.
function reloadRecordFor(state: WatchLedgerState, targetAtMs: number): PendingReload {
  const fresh: PendingReload = { changedAtMs: targetAtMs, respawnedSessionIds: [], notifiedSessionIds: [], skippedSessionIds: [] };
  return state.pendingReload?.changedAtMs === targetAtMs ? { ...fresh, ...state.pendingReload } : fresh;
}

function runReloadPass(
  record: PendingReload,
  claudeSessions: WorkSession[],
  watchOwnerSessionIds: Set<string>,
  deps: WatchTickDeps,
  at: string,
): { report: ReloadReport; pendingReload: PendingReload; events: WatchEvent[] } {
  const decisions = planReloadFanOut(claudeSessions, record, watchOwnerSessionIds);
  const report = executeReloadFanOut(decisions, deps.runCommand, (cwd) => canRestartSessionIn(cwd, deps.runCommand));
  return { report: report, pendingReload: advancePendingReload(record, report), events: reloadEvents(report, at) };
}

/** When every live session's plugins should date from, per the install log and Claude's plugin record. */
function reloadTargetAtMs(deps: WatchTickDeps, installs: InstallRecord[]): number | undefined {
  return resolveReloadTargetAtMs(installs, readUserPluginsUpdatedAtMs(deps.paths.claudeInstalledPluginsFile));
}

function closeOutTerminalSlots(assessments: WatchSlotAssessment[], deps: WatchTickDeps, at: string): {
  closedOutSlugs: string[];
  events: WatchEvent[];
} {
  const closedOutSlugs: string[] = [];
  const events: WatchEvent[] = [];
  for (const assessment of assessments) {
    if (!isSlotCloseOutDue(assessment) || !assessment.live) continue;
    const terminalState = assessment.live.state.toLowerCase();
    if (!closeOutWatchSlot(assessment.slotDir, assessment.pr, terminalState, new Date(deps.nowMs))) continue;
    closedOutSlugs.push(assessment.slug);
    events.push({
      at: at,
      kind: WatchEventKind.ClosedOut,
      subject: `${assessment.pr.repo}#${assessment.pr.number}`,
      message: `slot ${assessment.slug} closed out: PR ${terminalState}`,
    });
  }
  return { closedOutSlugs: closedOutSlugs, events: events };
}

function runTickUnlocked(deps: WatchTickDeps): WatchSnapshot {
  const at = new Date(deps.nowMs).toISOString();
  const installs = readInstallHistory(deps.paths.muggleInstallLogFile);
  const { processes, claudeSessions, sessions } = observeSessions(deps, installs);
  // Without Claude's listing no owner can be judged ended, which is what keeps
  // recovery from resuming a session that is in fact still running.
  const activeSessionIds = claudeSessions === null ? null : new Set(sessions.map((session) => session.sessionId));
  const slots = readOpenWatchSlots(deps.paths.slotsDir);
  const isPollingDisabled = isPrPollingDisabled(deps.paths.slotsDir);
  const state = readWatchLedgerState(deps.paths.watchDir);

  const slotPrs = slots.flatMap((slot) => slot.openPrs);
  const { prsToQuery, cachedStatuses } = partitionByTerminalCache(slotPrs, state.terminalPrsByUrl, deps.nowMs);
  const liveStatusesByUrl = fetchPrLiveStatuses(prsToQuery, deps.runCommand);
  const terminalPrsByUrl = updateTerminalCache(
    state.terminalPrsByUrl,
    [...liveStatusesByUrl.values()],
    new Set(slotPrs.map((pr) => pr.url)),
    at,
  );
  for (const cachedStatus of cachedStatuses) liveStatusesByUrl.set(cachedStatus.url, cachedStatus);

  const allAssessments = assessWatchSlots(slots, processes, activeSessionIds, liveStatusesByUrl, deps.nowMs);
  const closeOut = closeOutTerminalSlots(allAssessments, deps, at);
  const assessments = allAssessments.filter((assessment) => !closeOut.closedOutSlugs.includes(assessment.slug));
  const findings = deriveWatchFindings(assessments, processes ?? [], isPollingDisabled);

  const transitions = reconcileActiveFindings(state.activeFindings, findings, at);
  const events: WatchEvent[] = [
    ...transitions.raised.map((raised) => ({ at: at, kind: WatchEventKind.Raised, key: raised.key, code: raised.code, subject: raised.subject, message: raised.message })),
    ...transitions.cleared.map(({ key, record }) => ({ at: at, kind: WatchEventKind.Cleared, key: key, code: record.code, subject: record.subject })),
    ...closeOut.events,
  ];

  let recoveries: WatcherRecovery[] = [];
  let recoveryAttemptsByOwner = state.recoveryAttemptsByOwner;
  if (deps.isRecoveryEnabled) {
    const planned = planWatcherRecoveries(assessments, recoveryAttemptsByOwner, deps.nowMs, isPollingDisabled);
    const executed = executeWatcherRecoveries(planned, recoveryAttemptsByOwner, deps.runCommand, deps.paths.claudeProjectsDir, deps.nowMs);
    recoveries = executed.recoveries;
    recoveryAttemptsByOwner = executed.attemptsByOwner;
    events.push(...executed.events);
  }

  let pendingReload = state.pendingReload;
  let reload: ReloadReport | undefined;
  const targetAtMs = reloadTargetAtMs(deps, installs);
  if (deps.isAutoReloadEnabled && targetAtMs !== undefined && claudeSessions !== null) {
    const pass = runReloadPass(reloadRecordFor(state, targetAtMs), claudeSessions, watchOwnersOf(assessments), deps, at);
    pendingReload = pass.pendingReload;
    reload = pass.report;
    events.push(...pass.events);
  }

  appendWatchEvents(deps.paths.watchDir, events);
  notifyIfAny(deps, composeTickNotification(transitions.raised, recoveries, reload));
  writeWatchLedgerState(deps.paths.watchDir, {
    activeFindings: transitions.activeFindings,
    recoveryAttemptsByOwner: recoveryAttemptsByOwner,
    terminalPrsByUrl: terminalPrsByUrl,
    pendingReload: pendingReload,
  });
  const snapshot: WatchSnapshot = {
    takenAt: at,
    installedVersion: installs.length === 0 ? undefined : installs[installs.length - 1].version,
    sessions: sessions,
    processes: processes ?? [],
    slots: assessments,
    coverage: computeCoverage(assessments),
    closedOutSlugs: closeOut.closedOutSlugs,
    findings: findings,
    recoveries: recoveries,
    reload: reload,
  };
  writeWatchSnapshot(deps.paths.watchDir, snapshot);
  return snapshot;
}

/**
 * One pass of the standing watch: snapshot sessions, processes and PR slots,
 * record what changed, close out slots nobody else will, restore dead watchers
 * of registered slots by resuming their owner sessions, bring sessions behind
 * the installed build up to it, and notify on what is new.
 *
 * @throws When another run holds the watch lock.
 */
export function runWatchTick(deps: WatchTickDeps): WatchSnapshot {
  return lockedOrThrow(deps.paths.watchDir, () => runTickUnlocked(deps));
}

/**
 * Bring every live Claude session onto the plugins on disk now, whatever the
 * auto-reload switch says and whether or not an install changed them — a
 * checkout a session loads skills from changes without one. Restart the idle
 * background sessions loaded before now (resuming watch owners on reconcile)
 * and name the terminal ones; sessions still mid-turn are left for later
 * passes. Watch ownership comes from the last tick's snapshot.
 *
 * @returns The pass's report, or null when Claude's session listing could not be read.
 * @throws When another run holds the watch lock.
 */
export function runReloadPluginsPass(deps: WatchTickDeps, isDryRun: boolean): ReloadReport | null {
  return lockedOrThrow(deps.paths.watchDir, () => {
    const installs = readInstallHistory(deps.paths.muggleInstallLogFile);
    const { claudeSessions } = observeSessions(deps, installs);
    if (claudeSessions === null) return null;
    const state = readWatchLedgerState(deps.paths.watchDir);
    const record = reloadRecordFor(state, deps.nowMs);
    const watchOwnerSessionIds = watchOwnersOf(readWatchSnapshot(deps.paths.watchDir)?.slots ?? []);
    if (isDryRun) {
      return {
        decisions: planReloadFanOut(claudeSessions, record, watchOwnerSessionIds),
        respawnedSessionIds: [],
        failedSessionIds: [],
        untrustedSessionIds: [],
      };
    }
    const at = new Date(deps.nowMs).toISOString();
    const pass = runReloadPass(record, claudeSessions, watchOwnerSessionIds, deps, at);
    appendWatchEvents(deps.paths.watchDir, [
      { at: at, kind: WatchEventKind.ReloadRequested, message: "requested with muggle watch reload-plugins" },
      ...pass.events,
    ]);
    notifyIfAny(deps, composeTickNotification([], [], pass.report));
    writeWatchLedgerState(deps.paths.watchDir, { ...state, pendingReload: pass.pendingReload });
    return pass.report;
  });
}

function runInstaller(installerArgs: string[], deps: WatchServiceInstallDeps, succeededAs: WatchServiceInstallOutcome): WatchServiceInstallReport {
  if (deps.platform !== "win32") {
    return { outcome: WatchServiceInstallOutcome.Unsupported, detail: `no installer for ${deps.platform} yet — add this crontab line: ${WATCH_CRONTAB_LINE}` };
  }
  const scriptPath = findWatchInstallerScript();
  if (!scriptPath) return { outcome: WatchServiceInstallOutcome.Failed, detail: "the installer script is missing from this install" };
  const ran = runWatchInstaller(scriptPath, installerArgs, deps.runCommand);
  if (ran?.exitCode !== 0) {
    return { outcome: WatchServiceInstallOutcome.Failed, detail: ran ? ran.stdout.trim() || `installer exited ${ran.exitCode}` : "installer did not finish" };
  }
  return { outcome: succeededAs, detail: ran.stdout.trim() };
}

/**
 * Register the watch's scheduled task, or replace it in place when it exists.
 *
 * @param isNoWait - Return once the task is registered, without waiting for its first tick.
 */
export function installWatchService(deps: WatchServiceInstallDeps, isNoWait: boolean): WatchServiceInstallReport {
  return runInstaller(isNoWait ? ["-NoWait"] : [], deps, WatchServiceInstallOutcome.Installed);
}

/** Remove the watch's scheduled task; its ledger is kept. */
export function uninstallWatchService(deps: WatchServiceInstallDeps): WatchServiceInstallReport {
  return runInstaller(["-Uninstall"], deps, WatchServiceInstallOutcome.Removed);
}

/**
 * Act on `autoInstallWatchService` as an install or upgrade does: `always`
 * registers or refreshes the task. A task already registered is refreshed for
 * any value but `never`, so an upgrade never leaves it on an old launcher;
 * `never` leaves the machine as it is, and `ask` adds nothing new.
 */
export function applyWatchServicePreference(
  preference: PreferenceValue,
  deps: WatchServiceInstallDeps,
  isNoWait: boolean,
): WatchServiceInstallReport {
  if (preference === PreferenceValue.Never) {
    return { outcome: WatchServiceInstallOutcome.TurnedOff, detail: "autoInstallWatchService is never" };
  }
  if (deps.platform !== "win32" && preference !== PreferenceValue.Always) {
    return { outcome: WatchServiceInstallOutcome.NotRequested, detail: `autoInstallWatchService is ${preference}` };
  }
  const isRegistered = deps.platform === "win32" && isWatchTaskRegistered(deps.runCommand);
  if (!isRegistered && preference !== PreferenceValue.Always) {
    return { outcome: WatchServiceInstallOutcome.NotRequested, detail: `autoInstallWatchService is ${preference} and no task is registered` };
  }
  const installerArgs = isNoWait ? ["-NoWait"] : [];
  return runInstaller(installerArgs, deps, isRegistered ? WatchServiceInstallOutcome.Refreshed : WatchServiceInstallOutcome.Installed);
}

/** The last tick's snapshot, or null when the watch has never run. */
export function loadLastWatchSnapshot(paths: WatchPaths = resolveWatchPaths()): WatchSnapshot | null {
  return readWatchSnapshot(paths.watchDir);
}

/**
 * Opt a PR-watch slot into out-of-session recovery.
 *
 * @throws When the slot has no `prs.json` yet.
 */
export function registerWatchSlot(slotDir: string, now: Date = new Date()): void {
  writeSlotRegistration(resolve(slotDir), WATCH_REGISTRATION_SOURCE_CLI, now);
}

/** Withdraw a slot from recovery; returns false when it was not registered. */
export function unregisterWatchSlot(slotDir: string): boolean {
  return removeSlotRegistration(resolve(slotDir));
}
