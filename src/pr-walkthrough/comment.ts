import { E2E_SKIP_CODE_CLAIMS, NON_APP_PATH_SUMMARY } from "../e2e-skip/constants.js";
import { E2eSkipCode, type NoAppLogicChangeDetail } from "../e2e-skip/types.js";
import {
  LAST_FULL_RUN_OPENING,
  REPORT_SENTINEL,
  REPORT_SENTINEL_TAG,
  RERUN_NOTICE_BLOCK,
  RERUN_NOTICE_CLOSING,
  RERUN_NOTICE_OPENING,
  RETIRED_UNREASONED_SKIP_HEADLINE,
  SHORT_SHA_LENGTH,
  WALKTHROUGH_COMMENT_HEADING,
  WALKTHROUGH_SKIPPED_MARKER,
  WALKTHROUGH_SLOT_MARKER,
} from "./constants.js";
import { WalkthroughCommentStatus, WalkthroughVerdict } from "./types.js";

/**
 * Body of the placeholder posted when a PR opens: the first of the comment's
 * three stages — feasibility check, then the run in progress or why E2E is not
 * feasible, then the E2E report.
 */
export function renderReservedComment(): string {
  return (
    `${WALKTHROUGH_SLOT_MARKER}\n` +
    `${WALKTHROUGH_COMMENT_HEADING}\n\n` +
    `**Waiting for the E2E feasibility check.** This comment updates in place — next with the E2E run ` +
    `in progress or why E2E is not feasible for this change, then with the E2E report.`
  );
}

/**
 * Body that replaces the placeholder when the PR's first E2E run starts.
 *
 * Carries the run-in-progress banner, so it stays pending, keeps the
 * walkthrough check in progress, and is not re-marked by the run's later executions.
 *
 * @param startedAt - When the run started.
 */
export function renderRunningComment(startedAt: Date): string {
  return (
    `${WALKTHROUGH_SLOT_MARKER}\n` +
    `${WALKTHROUGH_COMMENT_HEADING}\n\n` +
    `${RERUN_NOTICE_OPENING}\n` +
    `**E2E running — waiting for the report.** Started ${formatUtcMinute(startedAt)}. ` +
    `This comment becomes the E2E report when the run finishes.\n` +
    `${RERUN_NOTICE_CLOSING}`
  );
}

/**
 * Body that settles the slot without a run.
 *
 * Takes a verified {@link E2eSkipCode} rather than prose, which is what keeps
 * another tool's output from wearing this heading: a skip reads as one of the
 * environment facts the guardrail checked for itself, or — for
 * `NOT_APPLICABLE` — as the agent's stated reason, labelled unverified.
 */
export function renderSkippedComment(code: E2eSkipCode, detail: string): string {
  const stated = detail.trim();
  if (code === E2eSkipCode.NotApplicable) return renderNotApplicableComment(stated);
  const qualifier = stated ? ` — ${stated}` : "";
  return (
    `${WALKTHROUGH_SLOT_MARKER}\n` +
    `${WALKTHROUGH_SKIPPED_MARKER}\n` +
    `${WALKTHROUGH_COMMENT_HEADING}\n\n` +
    `**E2E not feasible.** Muggle verified \`${code}\` — ${E2E_SKIP_CODE_CLAIMS[code]}${qualifier}.`
  );
}

// The one skip nothing verified, so it says so: the reason stands as the
// agent's, for the reviewer to accept or push back on.
function renderNotApplicableComment(reason: string): string {
  return (
    `${WALKTHROUGH_SLOT_MARKER}\n` +
    `${WALKTHROUGH_SKIPPED_MARKER}\n` +
    `${WALKTHROUGH_COMMENT_HEADING}\n\n` +
    `**E2E not feasible.** ${reason.replace(/\.$/, "")}.\n\n` +
    `_The coding agent judged that a browser run cannot exercise this change (\`${E2eSkipCode.NotApplicable}\`). ` +
    `Muggle did not verify this reason._`
  );
}

/**
 * Body that settles the slot on a PR a dependency bot opened.
 *
 * @param login - The bot's GitHub login, e.g. `dependabot[bot]`.
 */
export function renderDependencyBotComment(login: string): string {
  return (
    `${WALKTHROUGH_SLOT_MARKER}\n` +
    `${WALKTHROUGH_SKIPPED_MARKER}\n` +
    `${WALKTHROUGH_COMMENT_HEADING}\n\n` +
    `**E2E not feasible.** A dependency update opened by \`${login}\`; no coding session ran on it.`
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
  const qualifier = declared.reason ? ` — ${declared.reason}` : "";
  const evidence = lastFullRun
    ? `${LAST_FULL_RUN_OPENING}\n\n${lastFullRun}\n\n</details>`
    : "_No full E2E run is on record for this PR._";
  const headline = isHeadPastCycleStart
    ? `**E2E skipped — no app-logic change in \`${shortSha(head)}\`.**`
    : `**E2E skipped — no app-logic change since \`${shortSha(cycleStart)}\`.**`;
  const baseTip = declared.baseTipSha?.toLowerCase() ?? null;
  const verdict = baseTip
    ? `**E2E skipped — the rebase onto \`${shortSha(baseTip)}\` changed no app logic in this PR.** ` +
      `Muggle verified \`${E2eSkipCode.NoAppLogicChange}\` — every path whose own patch changed in the rebase of ` +
      `\`${shortSha(cycleStart)}\` is ${NON_APP_PATH_SUMMARY}, if any did${qualifier}.`
    : `${headline} Muggle verified \`${E2eSkipCode.NoAppLogicChange}\` — every path changed since ` +
      `\`${shortSha(cycleStart)}\` is ${NON_APP_PATH_SUMMARY}${qualifier}.`;
  return (
    `${WALKTHROUGH_SLOT_MARKER}\n` +
    `${WALKTHROUGH_SKIPPED_MARKER}\n` +
    `${WALKTHROUGH_COMMENT_HEADING}\n\n` +
    `${verdict}\n\n` +
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
  if (status === WalkthroughCommentStatus.Reported) {
    return withoutRerunNotice(body).replace(REPORT_SENTINEL_TAG, "").trim();
  }
  if (status !== WalkthroughCommentStatus.Skipped) return null;
  const start = body.indexOf(LAST_FULL_RUN_OPENING);
  if (start === -1) return null;
  return body
    .slice(start + LAST_FULL_RUN_OPENING.length)
    .replace(/\s*<\/details>\s*$/, "")
    .trim();
}

// Minute precision is enough for a reader to tell a run in flight from one a
// session abandoned, and a fixed UTC zone reads the same for every reviewer.
const formatUtcMinute = (date: Date): string => `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** Whether a designated comment already carries the banner of a run in progress. */
export function hasRerunNotice(body: string): boolean {
  return body.includes(RERUN_NOTICE_OPENING);
}

/** The designated comment with any rerun banner removed. */
export function withoutRerunNotice(body: string): string {
  return body.replace(RERUN_NOTICE_BLOCK, "");
}

/**
 * Whether a PR's designated walkthrough carries a rerun banner — the new run it
 * announces has not posted yet, so the walkthrough shown is not this PR's verdict.
 *
 * @param bodies - Every comment on the PR.
 */
export function isRerunInProgress(bodies: readonly string[]): boolean {
  return bodies.some(
    (body) => classifyComment(body) !== WalkthroughCommentStatus.NotDesignated && hasRerunNotice(body),
  );
}

/**
 * The designated comment with a banner on top saying a new E2E run started.
 *
 * The comment underneath is left whole, so it keeps classifying as it did and is
 * carried forward intact if the run never posts; until the new run's walkthrough
 * replaces it, the walkthrough check reports the run in progress.
 *
 * @param startedAt - When the new run started.
 */
export function withRerunNotice(body: string, startedAt: Date): string {
  return (
    `${RERUN_NOTICE_OPENING}\n` +
    `> **A new E2E run is in progress** — started ${formatUtcMinute(startedAt)}. ` +
    `The results below are from the previous run; this comment updates when the new run finishes.\n` +
    `${RERUN_NOTICE_CLOSING}\n\n` +
    withoutRerunNotice(body)
  );
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
  if (body.includes(WALKTHROUGH_SKIPPED_MARKER) && !body.includes(RETIRED_UNREASONED_SKIP_HEADLINE)) {
    return WalkthroughCommentStatus.Skipped;
  }
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
