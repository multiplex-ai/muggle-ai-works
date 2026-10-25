import { resolve } from "path";
import { readClaudeSessions } from "./claude-sessions.js";
import { readCodexSessions } from "./codex-sessions.js";
import { defaultCommandRunner } from "./command-runner.js";
import { WATCH_NOTIFICATION_TITLE, WATCH_REGISTRATION_SOURCE_CLI } from "./constants.js";
import { assessWatchSlots, deriveWatchFindings, reconcileActiveFindings } from "./findings.js";
import { shortSessionId } from "./format.js";
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
import { readPluginFingerprint } from "./plugin-fingerprint.js";
import { fetchPrLiveStatuses } from "./pr-status.js";
import { readProcessTable } from "./process-table.js";
import { executeWatcherRecoveries, planWatcherRecoveries } from "./recovery.js";
import { advancePendingReload, executeReloadFanOut, planReloadFanOut } from "./reload-plugins.js";
import { partitionByTerminalCache, updateTerminalCache } from "./terminal-pr-cache.js";
import { classifyTrackedProcesses } from "./tracked-processes.js";
import {
  isPrPollingDisabled,
  readOpenWatchSlots,
  removeSlotRegistration,
  writeSlotRegistration,
} from "./watch-slots.js";
import {
  WatchEventKind,
  type PendingReload,
  type ReloadReport,
  type WatcherRecovery,
  type WatchEvent,
  type WatchLedgerState,
  type WatchPaths,
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

function notifyIfAny(deps: WatchTickDeps, lines: string[]): void {
  if (lines.length > 0) deps.notify(WATCH_NOTIFICATION_TITLE, lines);
}

function lockedOrThrow<T>(watchDir: string, run: () => T): T {
  const outcome = withWatchLock(watchDir, run);
  if (outcome === undefined) throw new Error("another muggle watch run holds the lock — try again shortly");
  return outcome;
}

function reloadEvents(report: ReloadReport, at: string): WatchEvent[] {
  const sessionNameById = new Map(report.decisions.map((decision) => [decision.sessionId, decision.name]));
  const describe = (sessionId: string): string => `session ${sessionNameById.get(sessionId) ?? shortSessionId(sessionId)}`;
  return [
    ...report.respawnedSessionIds.map((sessionId) => ({ at: at, kind: WatchEventKind.Respawned, subject: describe(sessionId) })),
    ...report.failedSessionIds.map((sessionId) => ({ at: at, kind: WatchEventKind.RespawnFailed, subject: describe(sessionId) })),
  ];
}

function runReloadPass(
  pending: PendingReload,
  claudeSessions: WorkSession[],
  deps: WatchTickDeps,
  at: string,
): { report: ReloadReport; pendingReload?: PendingReload; events: WatchEvent[] } {
  const report = executeReloadFanOut(planReloadFanOut(claudeSessions, pending), deps.runCommand);
  return { report: report, pendingReload: advancePendingReload(pending, report), events: reloadEvents(report, at) };
}

// A first sighting only records the fingerprint: installing the watch must not
// restart every session on the machine. Turning auto-reload off stops new fan-outs
// starting, never one the user asked for with `reload-plugins`.
function stepPluginReload(
  state: WatchLedgerState,
  claudeSessions: WorkSession[] | null,
  deps: WatchTickDeps,
  at: string,
): Pick<WatchLedgerState, "pluginFingerprint" | "pendingReload"> & { report?: ReloadReport; events: WatchEvent[] } {
  const current = readPluginFingerprint(deps.paths.claudeInstalledPluginsFile);
  const events: WatchEvent[] = [];
  let pending = state.pendingReload;
  const hasChanged = current !== null && state.pluginFingerprint !== undefined && current.fingerprint !== state.pluginFingerprint;
  if (hasChanged && deps.isAutoReloadEnabled) {
    pending = {
      fingerprint: current.fingerprint,
      changedAtMs: current.changedAtMs ?? deps.nowMs,
      respawnedSessionIds: [],
      notifiedSessionIds: [],
    };
    events.push({ at: at, kind: WatchEventKind.ReloadRequested, message: "installed plugins changed" });
  }
  const pluginFingerprint = current?.fingerprint ?? state.pluginFingerprint;
  if (!pending || claudeSessions === null) return { pluginFingerprint: pluginFingerprint, pendingReload: pending, events: events };
  const pass = runReloadPass(pending, claudeSessions, deps, at);
  return {
    pluginFingerprint: pluginFingerprint,
    pendingReload: pass.pendingReload,
    report: pass.report,
    events: [...events, ...pass.events],
  };
}

function runTickUnlocked(deps: WatchTickDeps): WatchSnapshot {
  const at = new Date(deps.nowMs).toISOString();
  const table = readProcessTable(deps.platform, deps.runCommand, deps.nowMs);
  const processes = table ? classifyTrackedProcesses(table, deps.platform) : null;
  const claudeSessions = readClaudeSessions(deps.runCommand, deps.paths.claudeSessionRegistryDir);
  const sessions = [...(claudeSessions ?? []), ...readCodexSessions(deps.paths.codexSessionsDir, deps.nowMs)];
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

  const assessments = assessWatchSlots(slots, processes, activeSessionIds, liveStatusesByUrl, deps.nowMs);
  const findings = deriveWatchFindings(assessments, processes ?? [], isPollingDisabled);

  const transitions = reconcileActiveFindings(state.activeFindings, findings, at);
  const events: WatchEvent[] = [
    ...transitions.raised.map((raised) => ({ at: at, kind: WatchEventKind.Raised, key: raised.key, code: raised.code, subject: raised.subject, message: raised.message })),
    ...transitions.cleared.map(({ key, record }) => ({ at: at, kind: WatchEventKind.Cleared, key: key, code: record.code, subject: record.subject })),
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

  const reloadStep = stepPluginReload(state, claudeSessions, deps, at);
  events.push(...reloadStep.events);

  appendWatchEvents(deps.paths.watchDir, events);
  notifyIfAny(deps, composeTickNotification(transitions.raised, recoveries, reloadStep.report));
  writeWatchLedgerState(deps.paths.watchDir, {
    activeFindings: transitions.activeFindings,
    recoveryAttemptsByOwner: recoveryAttemptsByOwner,
    terminalPrsByUrl: terminalPrsByUrl,
    pluginFingerprint: reloadStep.pluginFingerprint,
    pendingReload: reloadStep.pendingReload,
  });
  const snapshot: WatchSnapshot = {
    takenAt: at,
    sessions: sessions,
    processes: processes ?? [],
    slots: assessments,
    findings: findings,
    recoveries: recoveries,
    reload: reloadStep.report,
  };
  writeWatchSnapshot(deps.paths.watchDir, snapshot);
  return snapshot;
}

/**
 * One pass of the standing watch: snapshot sessions, processes and PR slots,
 * record what changed, restore dead watchers of registered slots by resuming
 * their owner sessions, continue any plugin reload, and notify on what is new.
 *
 * @throws When another run holds the watch lock.
 */
export function runWatchTick(deps: WatchTickDeps): WatchSnapshot {
  return lockedOrThrow(deps.paths.watchDir, () => runTickUnlocked(deps));
}

/**
 * Reload plugins across every active Claude session now: respawn the idle
 * background ones and name the terminal ones. Sessions still mid-turn are left
 * pending, and later ticks finish them.
 *
 * @returns The pass's report, or null when Claude's session listing could not be read.
 * @throws When another run holds the watch lock.
 */
export function runReloadPluginsPass(deps: WatchTickDeps, isDryRun: boolean): ReloadReport | null {
  return lockedOrThrow(deps.paths.watchDir, () => {
    const claudeSessions = readClaudeSessions(deps.runCommand, deps.paths.claudeSessionRegistryDir);
    if (claudeSessions === null) return null;
    const state = readWatchLedgerState(deps.paths.watchDir);
    const current = readPluginFingerprint(deps.paths.claudeInstalledPluginsFile);
    const pending: PendingReload = {
      fingerprint: current?.fingerprint ?? state.pluginFingerprint ?? "",
      changedAtMs: deps.nowMs,
      respawnedSessionIds: [],
      notifiedSessionIds: [],
    };
    if (isDryRun) {
      return { decisions: planReloadFanOut(claudeSessions, pending), respawnedSessionIds: [], failedSessionIds: [] };
    }
    const at = new Date(deps.nowMs).toISOString();
    const pass = runReloadPass(pending, claudeSessions, deps, at);
    appendWatchEvents(deps.paths.watchDir, [
      { at: at, kind: WatchEventKind.ReloadRequested, message: "requested with muggle watch reload-plugins" },
      ...pass.events,
    ]);
    notifyIfAny(deps, composeTickNotification([], [], pass.report));
    writeWatchLedgerState(deps.paths.watchDir, {
      ...state,
      pluginFingerprint: current?.fingerprint ?? state.pluginFingerprint,
      pendingReload: pass.pendingReload,
    });
    return pass.report;
  });
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
