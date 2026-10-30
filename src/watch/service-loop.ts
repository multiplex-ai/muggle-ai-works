import { existsSync, readFileSync, renameSync, statSync } from "fs";
import { join } from "path";
import { ProviderPrState } from "../guardrails/types.js";
import {
  MAX_SERVICE_ARMS_PER_TICK,
  RECOVERY_COOLDOWN_MS,
  SERVICE_LOOP_DELIVERED_FILE,
  SERVICE_LOOP_OUTPUT_FILE,
  SERVICE_LOOP_REPORT_PREFIXES,
} from "./constants.js";
import {
  ClaudeTurnStatus,
  ServiceArmOutcome,
  ServiceLoopReportKind,
  WatcherLiveness,
  WatchEventKind,
  type ServiceArm,
  type ServiceLoopLauncher,
  type ServiceLoopReport,
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

/** The report of the last loop the watch started in this slot, or undefined when it has none waiting. */
export function readServiceLoopReport(slotDir: string): ServiceLoopReport | undefined {
  const outputPath = join(slotDir, SERVICE_LOOP_OUTPUT_FILE);
  try {
    return parseServiceLoopReport(readFileSync(outputPath, "utf-8"), statSync(outputPath).mtimeMs);
  } catch {
    return undefined;
  }
}

/** Whether a report names work the owner session must be woken for: new activity on its PR, or the PR ending. */
export function isOwnerWakeReport(report: ServiceLoopReport | undefined): boolean {
  return report?.kind === ServiceLoopReportKind.Event || report?.kind === ServiceLoopReportKind.Terminal;
}

/** Set a delivered report aside so no later tick wakes the owner for it again. */
export function markServiceLoopReportDelivered(slotDir: string): void {
  const outputPath = join(slotDir, SERVICE_LOOP_OUTPUT_FILE);
  if (existsSync(outputPath)) renameSync(outputPath, join(slotDir, SERVICE_LOOP_DELIVERED_FILE));
}

/**
 * Whether the watch should start this slot's loop itself. The loop runs as a
 * program, outside every session, so starting it spends no model turn and
 * interrupts nobody. It is skipped while the slot holds a report its owner has
 * not been woken for — a fresh loop would floor that work unread — and while
 * the owner is mid-turn, since that turn may be the cycle that re-arms it.
 *
 * @param ownerSession - The owner's session listing, when it is running.
 */
export function isServiceArmDue(assessment: WatchSlotAssessment, nowMs: number, ownerSession?: WorkSession): boolean {
  const report = assessment.serviceLoopReport;
  const isFailureCoolingDown = report?.kind === ServiceLoopReportKind.Failed && nowMs - report.writtenAtMs < RECOVERY_COOLDOWN_MS;
  return (
    assessment.isRegistered &&
    (assessment.watcher === WatcherLiveness.Dead || assessment.watcher === WatcherLiveness.Deaf) &&
    assessment.live?.state === ProviderPrState.Open &&
    assessment.live.baseBranch !== undefined &&
    assessment.ownerSessionId !== undefined &&
    ownerSession?.turnStatus !== ClaudeTurnStatus.Busy &&
    !isOwnerWakeReport(report) &&
    !isFailureCoolingDown
  );
}

/**
 * Start a loop for every slot that needs one, up to the per-tick cap.
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
    const isStarted = launchServiceLoop(assessment.slotDir, assessment.pr, assessment.live?.baseBranch as string);
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
