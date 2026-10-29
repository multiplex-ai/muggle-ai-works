/**
 * Finds the open pull request a checkout's branch heads, through the GitHub
 * CLI. Best effort: without `gh`, a login, or an open pull request, the
 * checkout is ordered as one with no pull request.
 */

import { execFile } from "node:child_process";

import { PR_LOOKUP_CACHE_MS, PR_LOOKUP_ENV, PR_LOOKUP_TIMEOUT_MS } from "./queue-priority-constants.js";
import type { ICheckoutPullRequest, PullRequestLookup } from "./queue-priority-types.js";

const lookupsByCwd = new Map<string, { pullRequest: ICheckoutPullRequest | null; lookedUpAt: number }>();

/**
 * The open pull request the branch checked out in `cwd` heads.
 *
 * @returns The pull request, or null when there is none or `gh` cannot say.
 */
export const lookUpCheckoutPullRequest: PullRequestLookup = async (cwd) => {
  if (process.env[PR_LOOKUP_ENV] === "off") return null;
  const cached = lookupsByCwd.get(cwd);
  if (cached !== undefined && Date.now() - cached.lookedUpAt < PR_LOOKUP_CACHE_MS) return cached.pullRequest;
  const pullRequest = parseOpenPullRequest(await runGhPrView(cwd));
  lookupsByCwd.set(cwd, { pullRequest: pullRequest, lookedUpAt: Date.now() });
  return pullRequest;
};

function runGhPrView(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "gh",
      ["pr", "view", "--json", "number,url,createdAt,state"],
      { cwd: cwd, timeout: PR_LOOKUP_TIMEOUT_MS, windowsHide: true, encoding: "utf-8" },
      (error, stdout) => {
        resolve(error ? null : stdout);
      },
    );
  });
}

// `gh pr view` also finds a branch's merged or closed pull request; only an open one ranks.
function parseOpenPullRequest(output: string | null): ICheckoutPullRequest | null {
  if (output === null) return null;
  try {
    const parsed = JSON.parse(output) as { number?: unknown; url?: unknown; createdAt?: unknown; state?: unknown };
    const createdAt = typeof parsed.createdAt === "string" ? Date.parse(parsed.createdAt) : Number.NaN;
    if (parsed.state !== "OPEN" || typeof parsed.number !== "number" || Number.isNaN(createdAt)) return null;
    return { number: parsed.number, url: typeof parsed.url === "string" ? parsed.url : "", createdAt: createdAt };
  } catch {
    return null;
  }
}
