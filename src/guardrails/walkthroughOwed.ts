import { execFileSync } from "child_process";
import { boundedChildTimeoutMs } from "../hook-budget/childProcessBudget.js";
import { WALKTHROUGH_SKIPPED_MARKER } from "../pr-walkthrough/constants.js";
import { GH_LOOKUP_TIMEOUT_MS, MAX_WALKTHROUGH_BLOCKS } from "./constants.js";
import { REPORT_SENTINEL } from "./prReportPost.js";
import { isPrCoveredBySkip } from "./skipScope.js";
import {
  WalkthroughGateAction,
  type CachedWalkthroughScan,
  type GuardrailState,
  type WalkthroughGateDecision,
} from "./types.js";

/**
 * The provider reads the gate needs: the working branch's PR, and whether a
 * given PR already carries a walkthrough — or, where `acceptsSkip`, the
 * settled record of a declared skip.
 */
export interface PrWalkthroughLookup {
  branchPrUrl: () => string | null;
  prCarriesWalkthrough: (prUrl: string, acceptsSkip: boolean) => boolean;
}

/** A scan of the PRs in play: which still owe a walkthrough, and which were confirmed to already carry one. */
export interface WalkthroughScan {
  owed: string[];
  verified: string[];
}

function runGh(args: string[]): string | null {
  const timeoutMs = boundedChildTimeoutMs(GH_LOOKUP_TIMEOUT_MS);
  if (timeoutMs === null) return null;
  try {
    return execFileSync("gh", args, {
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
  } catch {
    return null;
  }
}

export const defaultPrWalkthroughLookup: PrWalkthroughLookup = {
  branchPrUrl: () => {
    const url = runGh(["pr", "view", "--json", "url", "-q", ".url"])?.trim();
    return url && url.startsWith("http") ? url : null;
  },
  // Scans the description as well as the comments: muggle-do embeds the
  // walkthrough in the body at PR-creation time, and a comments-only check
  // would report that PR as owing one it already carries.
  prCarriesWalkthrough: (prUrl, acceptsSkip) => {
    const rendered = runGh(["pr", "view", prUrl, "--json", "body,comments"]);
    if (rendered === null) return true;
    return rendered.includes(REPORT_SENTINEL) || (acceptsSkip && rendered.includes(WALKTHROUGH_SKIPPED_MARKER));
  },
};

/**
 * The PRs in play that have no walkthrough yet.
 *
 * Candidates are the union of the PRs opened this session and the working
 * branch's PR. Neither source alone is enough: `prsHandled` only ever holds PRs
 * this session opened, so change-driven testing against a PR that already
 * existed — the common case — would never be caught; and the branch lookup
 * alone misses a session that opened a PR and then moved on. Where the union
 * over-reaches, the skip marker clears it for one declaration.
 *
 * Any PR the lookup cannot reach counts as carrying one. A gate that blocks on
 * its own inability to check is a gate that gets deleted, so being offline,
 * unauthenticated, or on a branch with no PR resolves to *not owed*.
 *
 * Output shape: `{ owed: ["https://…/pull/7"], verified: ["https://…/pull/4"] }`
 */
export function scanForOwedWalkthroughs(
  state: GuardrailState,
  lookup: PrWalkthroughLookup = defaultPrWalkthroughLookup,
): WalkthroughScan {
  const candidates = new Set(state.prsHandled);
  const branchPrUrl = lookup.branchPrUrl();
  if (branchPrUrl) candidates.add(branchPrUrl);

  // A run owes its walkthrough; a skip's record discharges a PR only when the
  // session skipped E2E outright, or when a skip was applied to that very PR —
  // another change in the session running E2E does not make this one's skip
  // any less true.
  const owed: string[] = [];
  const verified: string[] = [];
  for (const prUrl of candidates) {
    const acceptsSkip = state.e2eRun !== true || isPrCoveredBySkip(state, prUrl);
    if (lookup.prCarriesWalkthrough(prUrl, acceptsSkip)) verified.push(prUrl);
    else owed.push(prUrl);
  }
  return { owed: owed, verified: verified };
}

/**
 * Whether the walkthrough gate has anything to check: an acceptance run
 * happened, or an E2E skip was accepted, and neither has every PR in play been
 * verified nor a walkthrough skip declared. An accepted skip arms it because
 * recording the skip in session state is not the same as the PR showing it —
 * the write that carries it there runs detached, and nothing else would notice
 * if it never landed.
 */
export function isWalkthroughGateArmed(state: GuardrailState): boolean {
  const isSkipUnsettled = state.e2eSkipDeclaration !== undefined && state.e2eSkipSettledOnPrs !== true;
  const isOwed = state.e2eRun === true || isSkipUnsettled;
  return isOwed && state.walkthroughsVerified !== true && state.walkthroughSkipped !== true;
}

/**
 * Whether a cached scan still describes the PRs in play.
 *
 * Stale when a PR was opened since, or when a walkthrough was posted after the
 * scan began: that post may have settled a PR the scan found owed, and blocking
 * on it would send the session to post the same walkthrough twice.
 */
export function isWalkthroughScanCurrent(scan: CachedWalkthroughScan, state: GuardrailState): boolean {
  const scanned = new Set(scan.prsHandled);
  const coversHandledPrs =
    scanned.size === new Set(state.prsHandled).size && state.prsHandled.every((prUrl) => scanned.has(prUrl));
  const postedAt = state.walkthroughPostedAt;
  const followsLastPost = postedAt === undefined || (scan.startedAt ?? 0) >= postedAt;
  return coversHandledPrs && followsLastPost;
}

/** The PRs left once those this session was seen posting a walkthrough to are set aside. */
export function withoutPostedPrs(prUrls: string[], state: GuardrailState): string[] {
  const postedPrUrls = new Set(state.walkthroughPostedPrUrls ?? []);
  return prUrls.filter((prUrl) => !postedPrUrls.has(prUrl));
}

/**
 * Reopen the walkthrough check for a newly opened PR.
 *
 * A verification covers only the PRs in play when it ran, and every PR carries
 * the run or skip of its own change, so a record on the PRs before it says
 * nothing about this one. Same reference when there was nothing to reopen.
 */
export function applyPrOpenedToWalkthroughs(state: GuardrailState): GuardrailState {
  if (state.walkthroughsVerified !== true && state.e2eSkipSettledOnPrs !== true) return state;
  return { ...state, walkthroughsVerified: false, e2eSkipSettledOnPrs: false };
}

/**
 * Decide what the Stop hook does about the walkthrough hand-off.
 *
 * Pure: the caller runs the scan and passes the owed urls in.
 * - `None`    — nothing owed (gate not armed, every PR verified carrying one, or a walkthrough skip declared).
 * - `Block`   — a run or an accepted E2E skip owes a PR in play its walkthrough or skip record; force the turn on.
 * - `Release` — blocked `maxBlocks` times already; stop nagging so a result that genuinely
 *               cannot be posted can't trap the session.
 */
export function walkthroughGateDecision(
  state: GuardrailState,
  owedPrUrls: string[],
  maxBlocks: number = MAX_WALKTHROUGH_BLOCKS,
): WalkthroughGateDecision {
  const blockCount = state.walkthroughBlockCount ?? 0;
  if (!isWalkthroughGateArmed(state) || owedPrUrls.length === 0) {
    return { action: WalkthroughGateAction.None, blockCount: blockCount, owed: owedPrUrls };
  }
  if (blockCount >= maxBlocks) {
    return { action: WalkthroughGateAction.Release, blockCount: blockCount, owed: owedPrUrls };
  }
  return { action: WalkthroughGateAction.Block, blockCount: blockCount + 1, owed: owedPrUrls };
}
