import { existsSync } from "fs";
import { ProviderPrState } from "../guardrails/types.js";
import { findClaudeSessionCwd } from "./claude-transcripts.js";
import {
  MAX_RESUMES_PER_TICK,
  RECOVERY_ATTEMPT_WINDOW_MS,
  RECOVERY_COOLDOWN_MS,
  RECOVERY_MAX_ATTEMPTS,
  RECOVERY_RESUME_PROMPT,
} from "./constants.js";
import { shortSessionId } from "./format.js";
import {
  WatcherLiveness,
  WatcherRecoveryOutcome,
  WatchEventKind,
  type CommandRunner,
  type ExecutedRecoveries,
  type WatcherRecovery,
  type WatchEvent,
  type WatchSlotAssessment,
} from "./types.js";

/**
 * Whether the watch may restore this slot's watcher itself. Every condition
 * closes a way recovery could do harm: an unregistered slot never opted in, an
 * unconfirmed or terminal PR owes no watch, a live loop or a live owner would
 * mean two pollers, and an unknown owner has no context to resume into.
 */
export function isRecoverable(assessment: WatchSlotAssessment): boolean {
  return (
    assessment.isRegistered &&
    assessment.watcher === WatcherLiveness.Dead &&
    assessment.live?.state === ProviderPrState.Open &&
    assessment.ownerSessionId !== undefined &&
    assessment.isOwnerSessionActive === false
  );
}

/**
 * One recovery per owner session whose registered slots have dead watchers. A
 * single resume restores all of them, because reconcile re-arms every slot the
 * resumed session owns.
 *
 * Output shape: `[{ ownerSessionId: "349a…", slotSlugs: ["csv-export"], outcome: "resume-due" }]`
 */
export function planWatcherRecoveries(
  assessments: WatchSlotAssessment[],
  attemptsByOwner: Record<string, string[]>,
  nowMs: number,
  isPollingDisabled: boolean,
): WatcherRecovery[] {
  if (isPollingDisabled) return [];
  const slugsByOwner = new Map<string, Set<string>>();
  for (const assessment of assessments) {
    if (!isRecoverable(assessment)) continue;
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
    let outcome = WatcherRecoveryOutcome.ResumeDue;
    if (recentAttemptsMs.length >= RECOVERY_MAX_ATTEMPTS) outcome = WatcherRecoveryOutcome.AttemptsExhausted;
    else if (nowMs - lastAttemptMs < RECOVERY_COOLDOWN_MS) outcome = WatcherRecoveryOutcome.CoolingDown;
    else if (resumesPlanned >= MAX_RESUMES_PER_TICK) outcome = WatcherRecoveryOutcome.DeferredByTickCap;
    if (outcome === WatcherRecoveryOutcome.ResumeDue) resumesPlanned++;
    recoveries.push({
      ownerSessionId: ownerSessionId,
      slotSlugs: [...(slugsByOwner.get(ownerSessionId) ?? [])].sort(),
      outcome: outcome,
    });
  }
  return recoveries;
}

/**
 * Resume each due owner in the background from its own project dir, so its
 * reconcile re-arms the slots it armed. Anything not due passes through as planned.
 */
export function executeWatcherRecoveries(
  planned: WatcherRecovery[],
  attemptsByOwner: Record<string, string[]>,
  runCommand: CommandRunner,
  claudeProjectsDir: string,
  nowMs: number,
): ExecutedRecoveries {
  const nowIso = new Date(nowMs).toISOString();
  const nextAttemptsByOwner: Record<string, string[]> = {};
  for (const [ownerSessionId, attempts] of Object.entries(attemptsByOwner)) {
    const recent = attempts.filter((attemptedAt) => nowMs - Date.parse(attemptedAt) < RECOVERY_ATTEMPT_WINDOW_MS);
    if (recent.length > 0) nextAttemptsByOwner[ownerSessionId] = recent;
  }
  const events: WatchEvent[] = [];
  const recoveries = planned.map((recovery): WatcherRecovery => {
    if (recovery.outcome !== WatcherRecoveryOutcome.ResumeDue) return recovery;
    const cwd = findClaudeSessionCwd(claudeProjectsDir, recovery.ownerSessionId);
    if (!cwd || !existsSync(cwd)) return { ...recovery, outcome: WatcherRecoveryOutcome.TranscriptMissing };
    const outcome = runCommand("claude", ["--resume", recovery.ownerSessionId, "--bg", RECOVERY_RESUME_PROMPT], { cwd: cwd });
    const isResumed = outcome?.exitCode === 0;
    nextAttemptsByOwner[recovery.ownerSessionId] = [...(nextAttemptsByOwner[recovery.ownerSessionId] ?? []), nowIso];
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
