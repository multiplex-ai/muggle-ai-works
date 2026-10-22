import { E2E_SKIP_CODE_CLAIMS, NON_APP_PATH_SUMMARY } from "../e2e-skip/constants.js";
import { E2eSkipCode, type NoAppLogicChangeDetail } from "../e2e-skip/types.js";
import {
  LAST_FULL_RUN_OPENING,
  REPORT_SENTINEL,
  REPORT_SENTINEL_TAG,
  SHORT_SHA_LENGTH,
  WALKTHROUGH_COMMENT_HEADING,
  WALKTHROUGH_SKIPPED_MARKER,
  WALKTHROUGH_SLOT_MARKER,
} from "./constants.js";
import { WalkthroughCommentStatus, WalkthroughVerdict } from "./types.js";

/** Body of the placeholder posted when a PR opens, holding the slot until a run settles it. */
export function renderReservedComment(): string {
  return (
    `${WALKTHROUGH_SLOT_MARKER}\n` +
    `${WALKTHROUGH_COMMENT_HEADING}\n\n` +
    `_Awaiting the E2E acceptance run. Muggle edits this comment in place when the run finishes — ` +
    `or records why E2E does not apply to this change._`
  );
}

/**
 * Body that settles the slot without a run.
 *
 * Takes a verified {@link E2eSkipCode} rather than prose, which is what keeps
 * another tool's output from wearing this heading: the rendering has nowhere to
 * put a free-text justification, so a skip can only ever read as one of the
 * environment facts the guardrail checked for itself.
 */
export function renderSkippedComment(code: E2eSkipCode, detail: string): string {
  const stated = detail.trim();
  const qualifier = stated ? ` — ${stated}` : "";
  return (
    `${WALKTHROUGH_SLOT_MARKER}\n` +
    `${WALKTHROUGH_SKIPPED_MARKER}\n` +
    `${WALKTHROUGH_COMMENT_HEADING}\n\n` +
    `**No E2E run.** Muggle verified \`${code}\` — ${E2E_SKIP_CODE_CLAIMS[code]}${qualifier}.`
  );
}

/**
 * Body that settles the slot when the Stop gate gave up without a verified code.
 *
 * The gate releases after a bounded number of reminders so an un-runnable E2E
 * cannot trap a session. That release used to be silent, which made "nobody
 * gave a reason" indistinguishable on the PR from "E2E did not apply" — so it
 * now says so in the one place a reviewer is already looking.
 */
export function renderUnreasonedSkipComment(): string {
  return (
    `${WALKTHROUGH_SLOT_MARKER}\n` +
    `${WALKTHROUGH_SKIPPED_MARKER}\n` +
    `${WALKTHROUGH_COMMENT_HEADING}\n\n` +
    `**No E2E run, and no verified reason given.** The session ended still owing an acceptance run ` +
    `and cited no skip code that Muggle could verify. Treat this PR as unvalidated by E2E.`
  );
}

const shortSha = (sha: string): string => sha.slice(0, SHORT_SHA_LENGTH);

/**
 * Body that settles the slot for a cycle that changed no app logic.
 *
 * Names the head the PR now carries when it moved past the cycle's starting
 * commit, and keeps the last full run's walkthrough collapsed underneath, so a
 * reviewer sees both why this head ran no E2E and what the last run proved.
 *
 * @param headSha - The PR's head commit, or `null` when it could not be read.
 * @param lastFullRun - The carried-forward walkthrough, from {@link lastFullRunOf}.
 */
export function renderNoAppLogicChangeComment(
  declared: NoAppLogicChangeDetail,
  headSha: string | null,
  lastFullRun: string | null,
): string {
  const cycleStart = declared.preCycleSha.toLowerCase();
  const head = headSha?.toLowerCase() ?? null;
  const isHeadPastCycleStart = head !== null && !head.startsWith(cycleStart) && !cycleStart.startsWith(head);
  const headline = isHeadPastCycleStart
    ? `**E2E skipped — no app-logic change in \`${shortSha(head)}\`.**`
    : `**E2E skipped — no app-logic change since \`${shortSha(cycleStart)}\`.**`;
  const qualifier = declared.reason ? ` — ${declared.reason}` : "";
  const evidence = lastFullRun
    ? `${LAST_FULL_RUN_OPENING}\n\n${lastFullRun}\n\n</details>`
    : "_No full E2E run is on record for this PR._";
  return (
    `${WALKTHROUGH_SLOT_MARKER}\n` +
    `${WALKTHROUGH_SKIPPED_MARKER}\n` +
    `${WALKTHROUGH_COMMENT_HEADING}\n\n` +
    `${headline} Muggle verified \`${E2eSkipCode.NoAppLogicChange}\` — every path changed since ` +
    `\`${shortSha(cycleStart)}\` is ${NON_APP_PATH_SUMMARY}${qualifier}.\n\n` +
    evidence
  );
}

/**
 * The walkthrough a designated comment holds as its last full run.
 *
 * A reported comment is that run, with its sentinel removed so the comment
 * carrying it reads as skipped; a skipped comment hands on the run an earlier
 * cycle already carried forward.
 *
 * @returns `null` when the comment holds no run — pending, or skipped without one.
 */
export function lastFullRunOf(body: string): string | null {
  const status = classifyComment(body);
  if (status === WalkthroughCommentStatus.Reported) return body.replace(REPORT_SENTINEL_TAG, "").trim();
  if (status !== WalkthroughCommentStatus.Skipped) return null;
  const start = body.indexOf(LAST_FULL_RUN_OPENING);
  if (start === -1) return null;
  return body
    .slice(start + LAST_FULL_RUN_OPENING.length)
    .replace(/\s*<\/details>\s*$/, "")
    .trim();
}

/**
 * What one comment body is.
 *
 * A rendered walkthrough counts as reported whether or not it carries the slot
 * marker, so walkthroughs posted before this guard existed still discharge the
 * duty rather than reading as a PR that never ran one.
 */
export function classifyComment(body: string): WalkthroughCommentStatus {
  if (body.includes(REPORT_SENTINEL)) return WalkthroughCommentStatus.Reported;
  if (!body.includes(WALKTHROUGH_SLOT_MARKER)) return WalkthroughCommentStatus.NotDesignated;
  if (body.includes(WALKTHROUGH_SKIPPED_MARKER)) return WalkthroughCommentStatus.Skipped;
  return WalkthroughCommentStatus.Pending;
}

/** Whether a PR's comments discharge the walkthrough duty, reserve it, or leave it unclaimed. */
export function walkthroughVerdict(bodies: string[]): WalkthroughVerdict {
  const statuses = bodies.map(classifyComment);
  if (
    statuses.includes(WalkthroughCommentStatus.Reported) ||
    statuses.includes(WalkthroughCommentStatus.Skipped)
  ) {
    return WalkthroughVerdict.Satisfied;
  }
  if (statuses.includes(WalkthroughCommentStatus.Pending)) return WalkthroughVerdict.Pending;
  return WalkthroughVerdict.Missing;
}
