import { execFileSync } from "child_process";
import { GH_LOOKUP_TIMEOUT_MS, MAX_WALKTHROUGH_BLOCKS } from "./constants.js";
import { REPORT_SENTINEL } from "./prReportPost.js";
import {
  WalkthroughGateAction,
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
  try {
    return execFileSync("gh", args, {
      encoding: "utf-8",
      timeout: GH_LOOKUP_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
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

/**
 * Decide what the Stop hook does about the walkthrough hand-off.
 *
 * Pure: the caller runs the scan and passes the owed urls in.
 * - `None`    — nothing owed (no acceptance run, every PR carries one, or a post/skip is recorded).
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
    state.walkthroughPosted === true || state.walkthroughSkipped === true || state.e2eRun !== true;
  if (alreadySettled || owedPrUrls.length === 0) {
    return { action: WalkthroughGateAction.None, blockCount: blockCount, owed: owedPrUrls };
  }
  if (blockCount >= maxBlocks) {
    return { action: WalkthroughGateAction.Release, blockCount: blockCount, owed: owedPrUrls };
  }
  return { action: WalkthroughGateAction.Block, blockCount: blockCount + 1, owed: owedPrUrls };
}
