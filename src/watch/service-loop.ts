import { appendFileSync, existsSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "fs";
import { join } from "path";
import { ProviderPrState } from "../guardrails/types.js";
import { SERVICE_LOOP_DELIVERED_FILE, SERVICE_LOOP_OUTPUT_FILE, SERVICE_LOOP_QUEUED_WAKE_FILE } from "../pr-watch/constants.js";
import { readSlotText } from "../pr-watch/slotFiles.js";
import { MAX_SERVICE_ARMS_PER_TICK, RECOVERY_COOLDOWN_MS, SERVICE_LOOP_REPORT_PREFIXES } from "./constants.js";
import {
  ClaudeTurnStatus,
  ServiceArmOutcome,
  ServiceLoopReportKind,
  WatcherLiveness,
  WatchEventKind,
  type ServiceArm,
  type ServiceLoopLauncher,
  type ServiceLoopReport,
  type UndeliveredWake,
  type WatchEvent,
  type WatchSlotAssessment,
  type WorkSession,
} from "./types.js";

/**
 * Why a loop ended, from what it printed. The first line that names a reason
 * decides, in the order the loop can print them.
 *
 * Output shape: `{ kind: "event", reportLines: ["EVENT pr=7 new submitted review id=42"], writtenAtMs: 1793383626645 }`
 */
export function parseServiceLoopReport(outputText: string, writtenAtMs: number): ServiceLoopReport {
  const reportLines: string[] = [];
  let kind = ServiceLoopReportKind.Silent;
  for (const line of outputText.split(/\r?\n/)) {
    const match = SERVICE_LOOP_REPORT_PREFIXES.find((candidate) => line.startsWith(candidate.prefix));
    if (!match) continue;
    reportLines.push(line);
    if (kind === ServiceLoopReportKind.Silent) kind = match.kind;
  }
  return { kind: kind, reportLines: reportLines, writtenAtMs: writtenAtMs };
}

function readReportFile(reportPath: string): ServiceLoopReport | undefined {
  try {
    return parseServiceLoopReport(readFileSync(reportPath, "utf-8"), statSync(reportPath).mtimeMs);
  } catch {
    return undefined;
  }
}

/** The report of the last loop the watch started in this slot, or undefined when it has none waiting. */
export function readServiceLoopReport(slotDir: string): ServiceLoopReport | undefined {
  return readReportFile(join(slotDir, SERVICE_LOOP_OUTPUT_FILE));
}

/** The reports set aside for the owner while a fresh loop watches the PR, or undefined when none waits. */
export function readQueuedWakeReport(slotDir: string): ServiceLoopReport | undefined {
  const queued = readReportFile(join(slotDir, SERVICE_LOOP_QUEUED_WAKE_FILE));
  return isOwnerWakeReport(queued) ? queued : undefined;
}

/** Whether a report names work the owner session must be woken for: new activity on its PR, or the PR ending. */
export function isOwnerWakeReport(report: ServiceLoopReport | undefined): boolean {
  return report?.kind === ServiceLoopReportKind.Event || report?.kind === ServiceLoopReportKind.Terminal;
}

/**
 * The report the owner has not been woken for: the last loop's own once that loop has exited, or else what was set
 * aside when a fresh loop took over the PR.
 *
 * Output shape: `{ report: { kind: "event", reportLines: ["EVENT pr=7 new conversation comment id=9"], writtenAtMs: 1793383626645 }, ageMs: 60000 }`
 */
export function undeliveredWakeOf(assessment: WatchSlotAssessment): UndeliveredWake | undefined {
  const report = assessment.serviceLoopReport;
  if (report !== undefined && isOwnerWakeReport(report) && assessment.watcher !== WatcherLiveness.Polling) {
    return { report: report, ageMs: assessment.serviceLoopReportAgeMs };
  }
  if (assessment.queuedWakeReport === undefined) return undefined;
  return { report: assessment.queuedWakeReport, ageMs: assessment.queuedWakeReportAgeMs };
}

// A loop still exiting on Windows holds its output open, and the file cannot be removed until it lets go.
function removeIfPresent(filePath: string): boolean {
  try {
    rmSync(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Move an exited loop's undelivered report out of the output file a fresh loop truncates, appending it to the slot's
 * queued wakes so the owner is still woken for it.
 *
 * @returns Whether the output file is free for a fresh loop: nothing needed setting aside, or the report was moved.
 */
export function queueServiceLoopWakeReport(slotDir: string): boolean {
  const outputPath = join(slotDir, SERVICE_LOOP_OUTPUT_FILE);
  const report = readReportFile(outputPath);
  if (report === undefined || !isOwnerWakeReport(report)) return true;
  const outputText = readSlotText(outputPath);
  if (!removeIfPresent(outputPath)) return false;
  const queuedPath = join(slotDir, SERVICE_LOOP_QUEUED_WAKE_FILE);
  const isFirstQueued = !existsSync(queuedPath);
  appendFileSync(queuedPath, outputText.endsWith("\n") ? outputText : `${outputText}\n`);
  // The wait is measured from when the loop reported, not from when its report was moved.
  if (isFirstQueued) utimesSync(queuedPath, report.writtenAtMs / 1000, report.writtenAtMs / 1000);
  return true;
}

/** Set every delivered report aside, the last loop's and any queued, so no later tick wakes the owner for them again. */
export function markServiceLoopReportDelivered(slotDir: string): void {
  const outputPath = join(slotDir, SERVICE_LOOP_OUTPUT_FILE);
  const queuedPath = join(slotDir, SERVICE_LOOP_QUEUED_WAKE_FILE);
  const outputText = readSlotText(outputPath);
  const isOutputUndelivered = isOwnerWakeReport(parseServiceLoopReport(outputText, 0));
  const deliveredText = `${readSlotText(queuedPath)}${isOutputUndelivered ? outputText : ""}`;
  if (deliveredText === "") return;
  writeFileSync(join(slotDir, SERVICE_LOOP_DELIVERED_FILE), deliveredText);
  removeIfPresent(queuedPath);
  if (isOutputUndelivered) removeIfPresent(outputPath);
}

/**
 * Whether the watch should start this slot's loop itself. The loop runs as a
 * program, outside every session, so starting it spends no model turn and
 * interrupts nobody. A report its owner has not been woken for never holds the
 * PR unwatched: it is queued for the owner and the fresh loop watches on. An
 * owner mid-turn is otherwise left to re-arm, since that turn may be the cycle
 * that does, but not while a report waits on it: that proves the turn has not
 * heard the slot's last loop.
 *
 * @param ownerSession - The owner's session listing, when it is running.
 */
export function isServiceArmDue(assessment: WatchSlotAssessment, nowMs: number, ownerSession?: WorkSession): boolean {
  const report = assessment.serviceLoopReport;
  const isFailureCoolingDown = report?.kind === ServiceLoopReportKind.Failed && nowMs - report.writtenAtMs < RECOVERY_COOLDOWN_MS;
  const isLeftToOwnerTurn = ownerSession?.turnStatus === ClaudeTurnStatus.Busy && undeliveredWakeOf(assessment) === undefined;
  return (
    assessment.isRegistered &&
    (assessment.watcher === WatcherLiveness.Dead || assessment.watcher === WatcherLiveness.Deaf) &&
    assessment.live?.state === ProviderPrState.Open &&
    assessment.live.baseBranch !== undefined &&
    assessment.ownerSessionId !== undefined &&
    !isLeftToOwnerTurn &&
    !isFailureCoolingDown
  );
}

/**
 * Start a loop for every slot that needs one, up to the per-tick cap. Each
 * loop is claimed for the owner `owner.json` records, so a service arm never
 * leaves its slot unowned.
 *
 * @param ownerSessionOf - The owner's running session listing, undefined when it is not running.
 */
export function startServiceLoops(
  assessments: WatchSlotAssessment[],
  nowMs: number,
  isPollingDisabled: boolean,
  ownerSessionOf: (ownerSessionId: string) => WorkSession | undefined,
  launchServiceLoop: ServiceLoopLauncher,
): { serviceArms: ServiceArm[]; events: WatchEvent[] } {
  if (isPollingDisabled) return { serviceArms: [], events: [] };
  const at = new Date(nowMs).toISOString();
  const serviceArms: ServiceArm[] = [];
  const events: WatchEvent[] = [];
  const armedSlugs = new Set<string>();
  for (const assessment of assessments) {
    if (armedSlugs.has(assessment.slug)) continue;
    const ownerSession = assessment.ownerSessionId === undefined ? undefined : ownerSessionOf(assessment.ownerSessionId);
    if (!isServiceArmDue(assessment, nowMs, ownerSession)) continue;
    armedSlugs.add(assessment.slug);
    const subject = `${assessment.pr.repo}#${assessment.pr.number}`;
    if (serviceArms.length >= MAX_SERVICE_ARMS_PER_TICK) {
      serviceArms.push({ slug: assessment.slug, prUrl: assessment.pr.url, outcome: ServiceArmOutcome.DeferredByTickCap });
      continue;
    }
    if (!queueServiceLoopWakeReport(assessment.slotDir)) {
      serviceArms.push({ slug: assessment.slug, prUrl: assessment.pr.url, outcome: ServiceArmOutcome.DeferredByReportInUse });
      continue;
    }
    const isStarted = launchServiceLoop(
      assessment.slotDir,
      assessment.pr,
      assessment.live?.baseBranch as string,
      assessment.ownerSessionId as string,
    );
    serviceArms.push({ slug: assessment.slug, prUrl: assessment.pr.url, outcome: isStarted ? ServiceArmOutcome.Armed : ServiceArmOutcome.ArmFailed });
    events.push({
      at: at,
      kind: isStarted ? WatchEventKind.Armed : WatchEventKind.ArmFailed,
      subject: subject,
      message: isStarted ? `started the watch loop for ${assessment.slug}` : `could not start the watch loop for ${assessment.slug}`,
    });
  }
  return { serviceArms: serviceArms, events: events };
}
