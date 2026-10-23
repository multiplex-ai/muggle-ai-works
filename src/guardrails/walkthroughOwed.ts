import { execFileSync } from "child_process";
import { boundedChildTimeoutMs } from "../hook-budget/childProcessBudget.js";
import { GH_LOOKUP_TIMEOUT_MS, MAX_WALKTHROUGH_BLOCKS } from "./constants.js";
import { REPORT_SENTINEL } from "./prReportPost.js";
import {
  WalkthroughGateAction,
  type CachedWalkthroughScan,
  type GuardrailState,
  type WalkthroughGateDecision,
} from "./types.js";

/** The provider reads the gate needs: the working branch's PR, and whether a given PR already carries a walkthrough. */
export interface PrWalkthroughLookup {
  branchPrUrl: () => string | null;
  prCarriesWalkthrough: (prUrl: string) => boolean;
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
  prCarriesWalkthrough: (prUrl) => {
    const rendered = runGh(["pr", "view", prUrl, "--json", "body,comments"]);
    if (rendered === null) return true;
    return rendered.includes(REPORT_SENTINEL);
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

  const owed: string[] = [];
  const verified: string[] = [];
  for (const prUrl of candidates) {
    if (lookup.prCarriesWalkthrough(prUrl)) verified.push(prUrl);
    else owed.push(prUrl);
  }
  return { owed: owed, verified: verified };
}

/** Whether the walkthrough gate has anything to check: an acceptance run happened, and neither has every PR in play been verified nor a skip declared. */
export function isWalkthroughGateArmed(state: GuardrailState): boolean {
  return state.e2eRun === true && state.walkthroughsVerified !== true && state.walkthroughSkipped !== true;
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
 * the run of its own change, so a walkthrough on the PRs before it says nothing
 * about this one. Same reference when there was nothing to reopen.
 */
export function applyPrOpenedToWalkthroughs(state: GuardrailState): GuardrailState {
  return state.walkthroughsVerified === true ? { ...state, walkthroughsVerified: false } : state;
}

/**
 * Decide what the Stop hook does about the walkthrough hand-off.
 *
 * Pure: the caller runs the scan and passes the owed urls in.
 * - `None`    — nothing owed (no acceptance run, every PR verified carrying one, or a skip declared).
 * - `Block`   — an acceptance run happened and a PR in play has no walkthrough; force the turn on.
 * - `Release` — blocked `maxBlocks` times already; stop nagging so a result that genuinely
 *               cannot be posted can't trap the session.
 */
export function walkthroughGateDecision(
  state: GuardrailState,
  owedPrUrls: string[],
  maxBlocks: number = MAX_WALKTHROUGH_BLOCKS,
): WalkthroughGateDecision {
  const blockCount = state.walkthroughBlockCount ?? 0;
  const alreadySettled =
    state.walkthroughsVerified === true || state.walkthroughSkipped === true || state.e2eRun !== true;
  if (alreadySettled || owedPrUrls.length === 0) {
    return { action: WalkthroughGateAction.None, blockCount: blockCount, owed: owedPrUrls };
  }
  if (blockCount >= maxBlocks) {
    return { action: WalkthroughGateAction.Release, blockCount: blockCount, owed: owedPrUrls };
  }
  return { action: WalkthroughGateAction.Block, blockCount: blockCount + 1, owed: owedPrUrls };
}
