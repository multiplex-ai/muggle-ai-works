import { NON_APP_PATH_PATTERNS, PRE_CYCLE_SHA_TOKEN } from "./constants.js";
import type { NoAppLogicChangeDetail } from "./types.js";

/**
 * Split a `NO_APP_LOGIC_CHANGE` detail into the commit it names and the stated reason.
 *
 * @returns `null` when the detail does not open with a commit SHA.
 */
export function parseNoAppLogicChangeDetail(detail: string): NoAppLogicChangeDetail | null {
  const stated = detail.trim();
  const preCycleSha = stated.match(PRE_CYCLE_SHA_TOKEN)?.[1];
  if (!preCycleSha) return null;
  const reason = stated.slice(preCycleSha.length).replace(/^[\s:,;.-]+/, "").trim();
  return { preCycleSha: preCycleSha, reason: reason };
}

/** Whether a repo-relative path is in the fixed set that cannot change what a user's browser runs. */
export function isNonAppPath(repoRelativePath: string): boolean {
  return NON_APP_PATH_PATTERNS.some((pattern) => pattern.test(repoRelativePath));
}
