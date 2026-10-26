import { existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { isCiHeadAttempted, isRebaseBudgetExhausted, isRebaseKeyAttempted } from "../pr-watch/attempts.js";
import {
  ALWAYS_PREFERENCE_VALUE,
  LAST_SEEN_FILE_NAME,
  MUGGLE_DO_SESSIONS_PATH_SEGMENTS,
  OWNER_FILE_NAME,
  PRS_FILE_NAME,
  RESULT_FILE_NAME,
  WATCH_DUE_FILE_NAME,
} from "../pr-watch/constants.js";
import { lastSeenEntryFor, parseWatchDueRecord, readJsonRecord, readSlotPr, readSlotText } from "../pr-watch/slotFiles.js";
import type { SlotPrRecord, WatchDueRecord, WatchPreferences } from "../pr-watch/types.js";
import { userAuthoredTextsContaining } from "../transcript/userTurns.js";
import {
  STOPPED_SLOT_SUFFIX,
  TERMINAL_SLOT_PR_STATES,
  WATCH_HOLD_INSTRUCTION,
  WATCH_HOLD_PHRASE_PREFIX,
} from "./constants.js";
import {
  OwedWatchWorkKind,
  WatchFollowThroughAction,
  type GuardrailState,
  type OwedWatchWork,
  type WatchFollowThroughDecision,
} from "./types.js";

function mtimeMsOf(filePath: string): number | undefined {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return undefined;
  }
}

// A tick refreshes prs.json from the provider, so when it was written after the due record and names another head,
// the head moved and the record describes a commit that is gone. The loop rewrites the record on its next poll; this
// covers the gap, and a loop that has stopped.
function isDueRecordSuperseded(slotPath: string, slotPr: SlotPrRecord, dueRecord: WatchDueRecord): boolean {
  if (!slotPr.head_sha || slotPr.head_sha === dueRecord.headSha) return false;
  const prsWrittenAtMs = mtimeMsOf(join(slotPath, PRS_FILE_NAME));
  const dueWrittenAtMs = mtimeMsOf(join(slotPath, WATCH_DUE_FILE_NAME));
  return prsWrittenAtMs !== undefined && dueWrittenAtMs !== undefined && prsWrittenAtMs > dueWrittenAtMs;
}

/**
 * The watcher work one slot owes `sessionId`: due per the record its watch keeps (`watch-due.env`), and never
 * attempted per `last_seen.json`.
 *
 * - A rebase is owed when the branch was found behind or conflicting, `autoRebase` is `always`, the PR has catch-up
 *   budget left, and no rebase cycle ran for the `<head>..<base-tip>` key.
 * - A fix is owed when the head's checks settled red and no fix-ci cycle ran for that head.
 *
 * An escalation entry never excuses either: only an attempt counter does. Every file is local, so this answers within
 * a hook's budget; a slot another session owns, a stopped or finalized slot, and a terminal PR owe nothing.
 */
export function owedWorkInSlot(
  slotPath: string,
  slug: string,
  sessionId: string,
  preferences: WatchPreferences,
): OwedWatchWork[] {
  if (slug.endsWith(STOPPED_SLOT_SUFFIX)) return [];
  const dueRecord = parseWatchDueRecord(readSlotText(join(slotPath, WATCH_DUE_FILE_NAME)));
  if (!dueRecord) return [];
  if (readJsonRecord(join(slotPath, OWNER_FILE_NAME)).session_id !== sessionId) return [];
  if (existsSync(join(slotPath, RESULT_FILE_NAME))) return [];
  const slotPr = readSlotPr(slotPath);
  const prUrl = slotPr?.url;
  const prNumber = slotPr?.number;
  if (!slotPr?.repo || typeof prUrl !== "string" || typeof prNumber !== "number") return [];
  if ((TERMINAL_SLOT_PR_STATES as readonly string[]).includes((slotPr.state ?? "").toLowerCase())) return [];
  if (isDueRecordSuperseded(slotPath, slotPr, dueRecord)) return [];

  const lastSeenEntry = lastSeenEntryFor(readSlotText(join(slotPath, LAST_SEEN_FILE_NAME)), `${slotPr.repo}#${prNumber}`);
  const workOn = (kind: OwedWatchWorkKind, dueOn: string): OwedWatchWork => ({
    kind: kind,
    slug: slug,
    prUrl: prUrl,
    prNumber: prNumber,
    dueOn: dueOn,
  });
  const owed: OwedWatchWork[] = [];
  const isRebaseOwed =
    dueRecord.rebaseDueKey !== "" &&
    preferences.autoRebase === ALWAYS_PREFERENCE_VALUE &&
    !isRebaseBudgetExhausted(lastSeenEntry, preferences.maxCatchUpRebases) &&
    !isRebaseKeyAttempted(lastSeenEntry, dueRecord.rebaseDueKey);
  if (isRebaseOwed) owed.push(workOn(OwedWatchWorkKind.Rebase, dueRecord.rebaseDueKey));
  if (dueRecord.ciRedHeadSha !== "" && !isCiHeadAttempted(lastSeenEntry, dueRecord.ciRedHeadSha)) {
    owed.push(workOn(OwedWatchWorkKind.FixCi, dueRecord.ciRedHeadSha));
  }
  return owed;
}

/**
 * Every piece of watcher work the slots `sessionId` owns have due and never attempted. An unreadable sessions dir owes
 * nothing: this gate blocks only on evidence it could read.
 *
 * `sessionsDirOverride` points the scan at a throwaway tree for tests.
 */
export function findOwedWatchWork(
  sessionId: string,
  preferences: WatchPreferences,
  sessionsDirOverride?: string,
): OwedWatchWork[] {
  const sessionsDir = sessionsDirOverride ?? join(homedir(), ...MUGGLE_DO_SESSIONS_PATH_SEGMENTS);
  let slugs: string[];
  try {
    slugs = readdirSync(sessionsDir);
  } catch {
    return [];
  }
  return slugs.flatMap((slug) => owedWorkInSlot(join(sessionsDir, slug), slug, sessionId, preferences));
}

/** The PR numbers the user put on hold in a turn they typed themselves: each `HOLD WATCH #<n>` in one. */
export function heldPrNumbersIn(transcriptJsonl: string): number[] {
  const heldPrNumbers = new Set<number>();
  for (const userText of userAuthoredTextsContaining(transcriptJsonl, WATCH_HOLD_PHRASE_PREFIX)) {
    for (const hold of userText.matchAll(WATCH_HOLD_INSTRUCTION)) heldPrNumbers.add(Number(hold[1]));
  }
  return [...heldPrNumbers];
}

/** Record holds into the gate state, returning the same reference when none is new so the caller can skip a write. */
export function applyWatchHolds(state: GuardrailState, heldPrNumbers: number[]): GuardrailState {
  const recorded = state.watchHeldPrNumbers ?? [];
  const newlyHeld = heldPrNumbers.filter((prNumber) => !recorded.includes(prNumber));
  if (newlyHeld.length === 0) return state;
  return { ...state, watchHeldPrNumbers: [...recorded, ...newlyHeld] };
}

/**
 * Decide what the Stop hook does about watcher work the session sat on.
 *
 * Pure: the caller scans the slots and records holds first.
 * - `None`  — nothing owed, or everything owed is on a PR the user held.
 * - `Block` — due work nothing attempted; force the turn on.
 *
 * Deliberately no release after N blocks, unlike the other gates: a budget the session can wait out is the same hold
 * it took on its own. The exits are the attempt itself, a new head, and the user's `HOLD WATCH #<pr-number>`.
 */
export function watchFollowThroughDecision(
  state: GuardrailState,
  owedWork: OwedWatchWork[],
): WatchFollowThroughDecision {
  const heldPrNumbers = state.watchHeldPrNumbers ?? [];
  const owed = owedWork.filter((work) => !heldPrNumbers.includes(work.prNumber));
  const blockCount = state.watchFollowThroughBlockCount ?? 0;
  if (owed.length === 0) return { action: WatchFollowThroughAction.None, blockCount: blockCount, owed: owed };
  return { action: WatchFollowThroughAction.Block, blockCount: blockCount + 1, owed: owed };
}
