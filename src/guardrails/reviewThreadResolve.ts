import {
  GITHUB_RESOLVE_THREAD_MUTATION,
  GITLAB_RESOLVE_DISCUSSION_CALL,
  PROVIDER_API_INVOCATION,
} from "./constants.js";
import { ReviewThreadProvider, type HookInput } from "./types.js";

/** A resolve-gate verdict: whether to deny the tool call, and the instruction handed back to the model when denied. */
export interface ReviewThreadResolveResult {
  deny: boolean;
  reason?: string;
}

/**
 * Which provider's thread-resolve call this command performs, or `null` for none.
 *
 * Gated on a real `gh api` / `glab api` invocation rather than the mutation name
 * alone: the name appears in this repo's own skill files, tests, and any grep
 * that goes looking for it, none of which resolve anything.
 */
export function detectResolveCall(command: string): ReviewThreadProvider | null {
  if (!PROVIDER_API_INVOCATION.test(command)) return null;
  if (GITHUB_RESOLVE_THREAD_MUTATION.test(command)) return ReviewThreadProvider.GitHub;
  if (GITLAB_RESOLVE_DISCUSSION_CALL.test(command)) return ReviewThreadProvider.GitLab;
  return null;
}

const RESOLVE_DENIAL =
  "Blocked: resolving a review thread is the reviewer's call, not the loop's. Reply to the thread " +
  "instead — the `<!-- muggle-do:bot -->` marker on that reply is what retires it (a thread is " +
  "actionable only while it is unresolved AND its newest comment is unmarked), so resolving buys no " +
  "echo protection and costs the reviewer their record of what is still unverified. The loop has " +
  "twice hidden threads carrying fixes that were partly wrong. If a thread genuinely warrants " +
  "resolving, say so and let the reviewer close it in the UI; to nudge, run the resolve-reminder " +
  "stage, which lists addressed-but-open threads without touching them.";

/**
 * Deny any command that closes a review thread on the author's behalf, on either provider.
 *
 * Both forges get one rule. GitLab was exempt on the argument that resolving folds a
 * discussion out of the next tick's actionable set — but its own classification keys on the
 * same loop marker GitHub uses, so the reply alone already does that.
 */
export function evaluateReviewThreadResolve(input: HookInput): ReviewThreadResolveResult {
  if (input.tool_name !== "Bash") return { deny: false };
  const provider = detectResolveCall(input.tool_input?.command ?? "");
  if (!provider) return { deny: false };
  return { deny: true, reason: RESOLVE_DENIAL };
}
