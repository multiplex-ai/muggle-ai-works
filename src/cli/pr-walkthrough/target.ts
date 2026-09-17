import { readFileSync } from "fs";
import { defaultGhRunner } from "../../pr-walkthrough/gh.js";
import type { GhRunner } from "../../pr-walkthrough/types.js";
import type { PrWalkthroughCheckOptions } from "./types.js";

/** Flags accepted by `muggle pr-walkthrough-check`. */
export interface PrWalkthroughCheckFlags {
  repo?: string;
  pr?: string;
  headSha?: string;
  checkRun?: boolean;
}

interface ActionsEvent {
  pull_request?: { number?: number; head?: { sha?: string } };
  issue?: { number?: number; pull_request?: unknown };
}

function readEvent(eventPath: string | undefined): ActionsEvent {
  if (!eventPath) return {};
  try {
    return JSON.parse(readFileSync(eventPath, "utf-8")) as ActionsEvent;
  } catch {
    return {};
  }
}

// An issue_comment event names the PR but never its head commit, and its job
// runs against the default branch — so the sha the check run has to target is
// only reachable through the API.
function fetchHeadSha(repo: string, prNumber: number, run: GhRunner): string | null {
  try {
    return run(["api", `repos/${repo}/pulls/${prNumber}`, "--jq", ".head.sha"])?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * Work out which PR this invocation judges, from flags first and the Actions
 * event payload second.
 *
 * @returns `null` when no PR can be resolved — an issue comment on a plain
 * issue, or a repo that was never named.
 */
export function resolveCheckTarget(
  flags: PrWalkthroughCheckFlags,
  env: Record<string, string | undefined>,
  run: GhRunner = defaultGhRunner,
): PrWalkthroughCheckOptions | null {
  const repo = flags.repo ?? env.GITHUB_REPOSITORY;
  if (!repo) return null;

  const event = readEvent(env.GITHUB_EVENT_PATH);
  const commentedPrNumber = event.issue?.pull_request ? event.issue.number : undefined;
  const prNumber = Number(flags.pr ?? event.pull_request?.number ?? commentedPrNumber ?? NaN);
  if (!Number.isInteger(prNumber) || prNumber <= 0) return null;

  const headSha =
    flags.headSha ?? event.pull_request?.head?.sha ?? fetchHeadSha(repo, prNumber, run);
  if (!headSha) return null;

  return {
    repo: repo,
    prNumber: prNumber,
    headSha: headSha,
    publishCheckRun: flags.checkRun === true,
  };
}
