import { PreferenceKey, resolvePreferences } from "../../packages/mcps/src/index.js";
import { renderWatchStatus } from "../watch/render.js";
import {
  ReloadAction,
  WatchFindingSeverity,
  WatcherRecoveryOutcome,
  WatchServiceInstallOutcome,
  type ReloadReport,
  type WatchServiceInstallReport,
} from "../watch/types.js";
import {
  applyWatchServicePreference,
  createDefaultWatchServiceInstallDeps,
  createDefaultWatchTickDeps,
  installWatchService,
  loadLastWatchSnapshot,
  registerWatchSlot,
  runReloadPluginsPass,
  runWatchTick,
  uninstallWatchService,
  unregisterWatchSlot,
} from "../watch/watch-service.js";
import type {
  WatchInstallFlags,
  WatchReloadPluginsFlags,
  WatchSlotFlags,
  WatchStatusFlags,
  WatchTickFlags,
} from "./watch-types.js";

function failWith(message: string): void {
  process.stderr.write(`muggle watch: ${message}\n`);
  process.exitCode = 1;
}

/** `muggle watch tick` — one pass of the standing watch; the scheduled task runs this. */
export function watchTickCommand(flags: WatchTickFlags): void {
  try {
    const snapshot = runWatchTick(
      createDefaultWatchTickDeps({ isAutoReloadEnabled: flags.autoReload, isRecoveryEnabled: flags.recovery }),
    );
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
      return;
    }
    const alertCount = snapshot.findings.filter((current) => current.severity === WatchFindingSeverity.Alert).length;
    const resumedCount = snapshot.recoveries.filter((recovery) => recovery.outcome === WatcherRecoveryOutcome.Resumed).length;
    process.stdout.write(
      `muggle watch: ${snapshot.sessions.length} sessions, ${snapshot.slots.length} PR watches, ` +
        `${snapshot.findings.length} findings (${alertCount} alerts), ${resumedCount} owner sessions resumed\n`,
    );
  } catch (error) {
    failWith(error instanceof Error ? error.message : String(error));
  }
}

/** `muggle watch status` — the last tick's snapshot. */
export function watchStatusCommand(flags: WatchStatusFlags): void {
  const snapshot = loadLastWatchSnapshot();
  if (!snapshot) {
    failWith("no snapshot yet — install the service (scripts/muggle-watch/install-muggle-watch.ps1) or run `muggle watch tick`");
    return;
  }
  process.stdout.write(flags.json ? `${JSON.stringify(snapshot, null, 2)}\n` : renderWatchStatus(snapshot, Date.now()));
}

function renderReloadReport(report: ReloadReport, isDryRun: boolean): string {
  const lines = report.decisions.map((decision) => {
    const label = decision.name ?? decision.shortId ?? decision.sessionId;
    const failed = report.failedSessionIds.includes(decision.sessionId) ? " (restart failed)" : "";
    const refused = report.untrustedSessionIds.includes(decision.sessionId)
      ? ` (left running: ${decision.cwd ?? "its workspace"} refuses a background restart — run /reload-plugins in it)`
      : "";
    return `  ${decision.action.padEnd(16)} ${label}  ${decision.reason}${failed}${refused}`;
  });
  const isRestart = (action: ReloadAction): boolean => action === ReloadAction.Respawn || action === ReloadAction.ResumeReconcile;
  const respawnVerb = isDryRun ? "would restart" : "restarted";
  const respawnCount = isDryRun
    ? report.decisions.filter((decision) => isRestart(decision.action)).length
    : report.respawnedSessionIds.length;
  return [`muggle watch reload-plugins: ${respawnVerb} ${respawnCount}`, ...lines, ""].join("\n");
}

/** `muggle watch reload-plugins` — fan a plugin reload out across every active Claude session. */
export function watchReloadPluginsCommand(flags: WatchReloadPluginsFlags): void {
  try {
    const isDryRun = flags.dryRun === true;
    const report = runReloadPluginsPass(createDefaultWatchTickDeps({ isAutoReloadEnabled: true, isRecoveryEnabled: false }), isDryRun);
    if (!report) {
      failWith("could not list Claude sessions (`claude agents --json` failed)");
      return;
    }
    process.stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : renderReloadReport(report, isDryRun));
  } catch (error) {
    failWith(error instanceof Error ? error.message : String(error));
  }
}

/**
 * `muggle watch install` — register or refresh the watch's scheduled task;
 * `--from-preference` acts on `autoInstallWatchService` instead, which is how
 * postinstall calls it, and `--uninstall` removes the task.
 */
export function watchInstallCommand(flags: WatchInstallFlags): void {
  const deps = createDefaultWatchServiceInstallDeps();
  const isNoWait = !flags.wait;
  let report: WatchServiceInstallReport;
  if (flags.uninstall) report = uninstallWatchService(deps);
  else if (flags.fromPreference) report = applyWatchServicePreference(resolvePreferences()[PreferenceKey.AutoInstallWatchService], deps, isNoWait);
  else report = installWatchService(deps, isNoWait);
  if (report.outcome === WatchServiceInstallOutcome.Failed || (report.outcome === WatchServiceInstallOutcome.Unsupported && !flags.fromPreference)) {
    failWith(`${report.outcome}: ${report.detail}`);
    return;
  }
  process.stdout.write(`muggle watch install: ${report.outcome}${report.detail ? ` — ${report.detail}` : ""}\n`);
}

/** `muggle watch register --slot <dir>` — opt a PR-watch slot into out-of-session recovery. */
export function watchRegisterCommand(flags: WatchSlotFlags): void {
  try {
    registerWatchSlot(flags.slot);
    process.stdout.write(`muggle watch: registered ${flags.slot}\n`);
  } catch (error) {
    failWith(error instanceof Error ? error.message : String(error));
  }
}

/** `muggle watch unregister --slot <dir>` — withdraw a slot from recovery; it is still reported on. */
export function watchUnregisterCommand(flags: WatchSlotFlags): void {
  const wasRegistered = unregisterWatchSlot(flags.slot);
  process.stdout.write(`muggle watch: ${wasRegistered ? "unregistered" : "was not registered:"} ${flags.slot}\n`);
}
