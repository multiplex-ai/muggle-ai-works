import { isShellToolCall } from "./shellTool.js";
import type { GuardrailState, HookInput } from "./types.js";
import { callFailed } from "./callOutcome.js";
import { extractPrUrls } from "./prUrls.js";
import {
  REPORT_SENTINEL,
  collectPrPostText,
  defaultFileReader,
  isPrReportPostCommand,
  type FileReader,
} from "./prReportPost.js";

// A deliberate "no walkthrough owed here" declaration: the model runs
// `echo "MUGGLE_WALKTHROUGH_SKIP: <reason>"` and the gate stays quiet for the
// session (postPRVisualWalkthrough=never, results belonging to someone else's
// PR, an acceptance run with nothing postable). Anchored to a leading echo for
// the same reason the E2E and watcher markers are — a grep, commit, or skill
// edit that merely mentions the token must not disarm the gate.
const WALKTHROUGH_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_WALKTHROUGH_SKIP\b/;

/** Whether a Bash command is the explicit walkthrough-skip declaration. */
export function isWalkthroughSkipMarker(cmd: string): boolean {
  return WALKTHROUGH_SKIP_MARKER.test(cmd);
}

/**
 * Whether this tool call published a rendered walkthrough.
 *
 * Recognised by the renderer's sentinel in whatever body the gate can read, so
 * it registers the same way whether the walkthrough was posted as a new
 * comment, embedded in a PR description at creation, or edited into an existing
 * comment on a rerun.
 */
export function detectWalkthroughPost(
  input: HookInput,
  read: FileReader = defaultFileReader,
): boolean {
  if (!isShellToolCall(input)) return false;
  const cmd = input.tool_input?.command ?? "";
  if (!isPrReportPostCommand(cmd)) return false;
  // A publish the provider rejected posted nothing, so it must not settle the
  // gate — the PR would be left with no walkthrough and no reminder that it is
  // owed one.
  if (callFailed(input)) return false;
  return collectPrPostText(cmd, input.cwd, read).includes(REPORT_SENTINEL);
}

/**
 * The PRs a walkthrough post reached, read from what the provider printed back.
 *
 * `gh pr comment` and `gh pr create` print the URL they wrote to, and a comment
 * edit through `gh api` returns the comment's `html_url`. The command itself is
 * not read: a body can quote other PRs, and settling those would let one
 * change's walkthrough stand in for another's.
 *
 * Output shape: `["https://github.com/o/r/pull/7"]` — empty when the output names none.
 */
export function detectWalkthroughPostTargets(input: HookInput): string[] {
  return extractPrUrls(`${input.tool_response?.stdout ?? ""}\n${input.tool_response?.output ?? ""}`);
}

/**
 * Record a walkthrough post against the PRs it reached, returning the same reference when nothing was posted.
 *
 * A post settles only its own PR. When the output names none, the post is
 * timestamped instead, and the gate learns which PRs now carry one from a scan
 * begun after it.
 */
export function applyWalkthroughPosted(
  state: GuardrailState,
  posted: boolean,
  postedAt: number,
  targetPrUrls: string[],
): GuardrailState {
  if (!posted) return state;
  if (targetPrUrls.length === 0) return { ...state, walkthroughPostedAt: postedAt };
  const postedPrUrls = new Set([...(state.walkthroughPostedPrUrls ?? []), ...targetPrUrls]);
  return { ...state, walkthroughPostedPrUrls: [...postedPrUrls] };
}

/** Record a walkthrough skip, returning the same reference when nothing changed so the caller can skip a redundant write. */
export function applyWalkthroughSkip(state: GuardrailState, skipped: boolean): GuardrailState {
  if (!skipped || state.walkthroughSkipped === true) return state;
  return { ...state, walkthroughSkipped: true };
}
