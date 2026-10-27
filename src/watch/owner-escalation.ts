import { isCiHeadEscalated, isRebaseKeyEscalated } from "../pr-watch/attempts.js";
import { REBASE_KEY_SEPARATOR } from "../pr-watch/constants.js";
import { lastSeenEntryFor } from "../pr-watch/slotFiles.js";
import { FOLLOWUP_LOG_ESCALATED_WORD, OWNER_ESCALATION_NOTE_MAX_CHARS } from "./constants.js";
import { OwnerEscalationKind, type OwnerEscalation, type SlotPr } from "./types.js";

// The note only explains the escalation; `last_seen.json` alone decides whether
// there is one, so a reworded log line can never raise or clear the finding.
function latestEscalationNote(followupLogLines: string[], prNumber: number): string | undefined {
  const prToken = new RegExp(`\\bpr=${prNumber}\\b`);
  for (let lineIndex = followupLogLines.length - 1; lineIndex >= 0; lineIndex--) {
    const logLine = followupLogLines[lineIndex];
    if (!prToken.test(logLine) || !logLine.includes(FOLLOWUP_LOG_ESCALATED_WORD)) continue;
    const note = logLine.replace(/^\S+\s+/, "").trim();
    return note.length > OWNER_ESCALATION_NOTE_MAX_CHARS ? `${note.slice(0, OWNER_ESCALATION_NOTE_MAX_CHARS - 1)}…` : note;
  }
  return undefined;
}

/**
 * What a PR's watcher has handed to its owner session and is now waiting on,
 * judged with the predicates behind the watcher tick's `block-*` verdicts. CI and
 * conflict escalations count only on the live head; a conflict counts against any
 * base tip, since the watch knows the head but not the base tip.
 *
 * Output shape: `{ kinds: ["ci", "conflict"], note: "fix-ci pr=702 head=a8c8… escalated: awaiting owner decision" }`
 *
 * @param headSha - The PR's live head, undefined when GitHub did not report one.
 * @returns Undefined when nothing waits on the owner.
 */
export function resolveOwnerEscalation(
  lastSeenJson: string,
  followupLogLines: string[],
  pr: SlotPr,
  headSha: string | undefined,
): OwnerEscalation | undefined {
  const lastSeenEntry = lastSeenEntryFor(lastSeenJson, `${pr.repo}#${pr.number}`);
  const kinds: OwnerEscalationKind[] = [];
  if (headSha !== undefined) {
    if (isCiHeadEscalated(lastSeenEntry, headSha)) kinds.push(OwnerEscalationKind.Ci);
    const escalatedKeys = Array.isArray(lastSeenEntry.conflict_escalated_keys) ? lastSeenEntry.conflict_escalated_keys : [];
    const isConflictEscalated = escalatedKeys.some(
      (rebaseKey) =>
        typeof rebaseKey === "string" &&
        rebaseKey.startsWith(`${headSha}${REBASE_KEY_SEPARATOR}`) &&
        isRebaseKeyEscalated(lastSeenEntry, rebaseKey),
    );
    if (isConflictEscalated) kinds.push(OwnerEscalationKind.Conflict);
  }
  if (Array.isArray(lastSeenEntry.escalated_review_ids) && lastSeenEntry.escalated_review_ids.length > 0) {
    kinds.push(OwnerEscalationKind.Reviews);
  }
  if (kinds.length === 0) return undefined;
  const note = latestEscalationNote(followupLogLines, pr.number);
  return note === undefined ? { kinds: kinds } : { kinds: kinds, note: note };
}
