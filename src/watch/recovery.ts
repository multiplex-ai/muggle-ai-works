import { existsSync } from "fs";
import { ProviderPrState } from "../guardrails/types.js";
import { findClaudeSessionCwd } from "./claude-transcripts.js";
import {
  MAX_RESUMES_PER_TICK,
  RECOVERY_ATTEMPT_WINDOW_MS,
  RECOVERY_COOLDOWN_MS,
  RECOVERY_MAX_ATTEMPTS,
} from "./constants.js";
import { shortSessionId } from "./format.js";
import { isTerminalPrState } from "./pr-status.js";
import { isIdleBackgroundSession } from "./session-liveness.js";
import { resumeOnReconcile } from "./session-restart.js";
import {
  WatcherLiveness,
  WatcherRecoveryOutcome,
  WatchEventKind,
  type ExecutedRecoveries,
  type RecoveryExecutionDeps,
  type WatcherRecovery,
  type WatchEvent,
  type WatchSlotAssessment,
  type WorkSession,
} from "./types.js";

/**
 * Whether the watch may restore this slot's watcher itself. Every condition
 * closes a way recovery could do harm: an unregistered slot never opted in, an
 * unconfirmed or terminal PR owes no watch, a live loop would mean two pollers,
 * and an unknown owner has no context to resume into. A running owner is
 * recoverable only between turns — a turn in flight may be re-arming already,
 * and one waiting on its user must not lose the question.
 *
 * @param ownerSession - The owner's session listing, when it is running.
 */
export function isRecoverable(assessment: WatchSlotAssessment, ownerSession?: WorkSession): boolean {
  const isOwnerRestartable =
    assessment.isOwnerSessionActive === false ||
    (assessment.isOwnerSessionActive === true && ownerSession !== undefined && isIdleBackgroundSession(ownerSession));
  return (
    assessment.isRegistered &&
    assessment.watcher === WatcherLiveness.Dead &&
    assessment.live?.state === ProviderPrState.Open &&
    assessment.ownerSessionId !== undefined &&
    isOwnerRestartable
  );
}

/**
 * Whether the watch should close out this slot itself: GitHub reports its PR
 * merged or closed, no loop is watching it, and its owner session is not
 * running. A running owner's own watcher or reconcile finalizes the slot and
 * dispatches its post-merge cleanup, and closing the slot first would make that
 * session skip the cleanup.
 */
export function isSlotCloseOutDue(assessment: WatchSlotAssessment): boolean {
  return isTerminalPrState(assessment.live?.state) && assessment.watcher === WatcherLiveness.Dead && assessment.isOwnerSessionActive !== true;
}

/**
 * One recovery per owner session whose registered slots have dead watchers. A
 * single resume restores all of them, because reconcile re-arms every slot the
 * resumed session owns. An owner whose last reply is the usage-limit notice
 * keeps being retried past the attempt cap: those attempts never ran.
 *
 * Output shape: `[{ ownerSessionId: "349a…", slotSlugs: ["csv-export"], outcome: "resume-due", ownerShortId: "349a8d3f" }]`
 *
 * @param sessionsById - Running sessions, so a live owner can be judged idle.
 * @param isStoppedAtUsageLimit - Whether the owner's last turn ended on the usage limit.
 */
export function planWatcherRecoveries(
  assessments: WatchSlotAssessment[],
  attemptsByOwner: Record<string, string[]>,
  nowMs: number,
  isPollingDisabled: boolean,
  sessionsById: Map<string, WorkSession> = new Map(),
  isStoppedAtUsageLimit: (sessionId: string) => boolean = () => false,
): WatcherRecovery[] {
  if (isPollingDisabled) return [];
  const slugsByOwner = new Map<string, Set<string>>();
  for (const assessment of assessments) {
    const ownerSession = assessment.ownerSessionId === undefined ? undefined : sessionsById.get(assessment.ownerSessionId);
    if (!isRecoverable(assessment, ownerSession)) continue;
    const ownerSessionId = assessment.ownerSessionId as string;
    const slugs = slugsByOwner.get(ownerSessionId) ?? new Set<string>();
    slugs.add(assessment.slug);
    slugsByOwner.set(ownerSessionId, slugs);
  }
  let resumesPlanned = 0;
  const recoveries: WatcherRecovery[] = [];
  for (const ownerSessionId of [...slugsByOwner.keys()].sort()) {
    const recentAttemptsMs = (attemptsByOwner[ownerSessionId] ?? [])
      .map((attemptedAt) => Date.parse(attemptedAt))
      .filter((attemptedAtMs) => !Number.isNaN(attemptedAtMs) && nowMs - attemptedAtMs < RECOVERY_ATTEMPT_WINDOW_MS);
    const lastAttemptMs = Math.max(-Infinity, ...recentAttemptsMs);
    const isCapReached = recentAttemptsMs.length >= RECOVERY_MAX_ATTEMPTS && !isStoppedAtUsageLimit(ownerSessionId);
    let outcome = WatcherRecoveryOutcome.ResumeDue;
    if (isCapReached) outcome = WatcherRecoveryOutcome.AttemptsExhausted;
    else if (nowMs - lastAttemptMs < RECOVERY_COOLDOWN_MS) outcome = WatcherRecoveryOutcome.CoolingDown;
    else if (resumesPlanned >= MAX_RESUMES_PER_TICK) outcome = WatcherRecoveryOutcome.DeferredByTickCap;
    if (outcome === WatcherRecoveryOutcome.ResumeDue) resumesPlanned++;
    const runningOwner = sessionsById.get(ownerSessionId);
    recoveries.push({
      ownerSessionId: ownerSessionId,
      slotSlugs: [...(slugsByOwner.get(ownerSessionId) ?? [])].sort(),
      outcome: outcome,
      ...(runningOwner?.shortId === undefined ? {} : { ownerShortId: runningOwner.shortId }),
    });
  }
  return recoveries;
}

/**
 * Resume each due owner in the background from its own project dir, so its
 * reconcile re-arms the slots it armed. A still-running owner is restarted
 * only where `canRestartIn` confirms Claude will bring it back. Anything not
 * due passes through as planned.
 */
export function executeWatcherRecoveries(
  planned: WatcherRecovery[],
  attemptsByOwner: Record<string, string[]>,
  deps: RecoveryExecutionDeps,
): ExecutedRecoveries {
  const nowIso = new Date(deps.nowMs).toISOString();
  const nextAttemptsByOwner: Record<string, string[]> = {};
  for (const [ownerSessionId, attempts] of Object.entries(attemptsByOwner)) {
    const recent = attempts.filter((attemptedAt) => deps.nowMs - Date.parse(attemptedAt) < RECOVERY_ATTEMPT_WINDOW_MS);
    if (recent.length > 0) nextAttemptsByOwner[ownerSessionId] = recent;
  }
  const events: WatchEvent[] = [];
  const recoveries = planned.map((recovery): WatcherRecovery => {
    if (recovery.outcome !== WatcherRecoveryOutcome.ResumeDue) return recovery;
    const cwd = findClaudeSessionCwd(deps.claudeProjectsDir, recovery.ownerSessionId);
    if (!cwd || !existsSync(cwd)) return { ...recovery, outcome: WatcherRecoveryOutcome.TranscriptMissing };
    // A refused restart counts too, so the trust probe waits out the cooldown instead of relaunching every tick.
    nextAttemptsByOwner[recovery.ownerSessionId] = [...(nextAttemptsByOwner[recovery.ownerSessionId] ?? []), nowIso];
    if (recovery.ownerShortId !== undefined && !deps.canRestartIn(cwd)) {
      events.push({
        at: nowIso,
        kind: WatchEventKind.RestartRefused,
        subject: `session ${shortSessionId(recovery.ownerSessionId)}`,
        message: `left running: Claude would not resume it in ${cwd}, so ${recovery.slotSlugs.join(", ")} stay unwatched`,
      });
      return { ...recovery, cwd: cwd, outcome: WatcherRecoveryOutcome.RestartRefused };
    }
    const isResumed = resumeOnReconcile(
      { sessionId: recovery.ownerSessionId, cwd: cwd, runningShortId: recovery.ownerShortId },
      deps.runCommand,
      deps.waitForExit,
    );
    events.push({
      at: nowIso,
      kind: isResumed ? WatchEventKind.Resumed : WatchEventKind.ResumeFailed,
      subject: `session ${shortSessionId(recovery.ownerSessionId)}`,
      message: `${isResumed ? "resumed" : "could not resume"} to re-arm ${recovery.slotSlugs.join(", ")}`,
    });
    return {
      ...recovery,
      cwd: cwd,
      outcome: isResumed ? WatcherRecoveryOutcome.Resumed : WatcherRecoveryOutcome.ResumeFailed,
    };
  });
  return { recoveries: recoveries, attemptsByOwner: nextAttemptsByOwner, events: events };
}
