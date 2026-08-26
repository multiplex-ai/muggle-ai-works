import type { GuardrailState, HookInput } from "./types.js";
import { callFailed } from "./callOutcome.js";
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
  if (input.tool_name !== "Bash") return false;
  const cmd = input.tool_input?.command ?? "";
  if (!isPrReportPostCommand(cmd)) return false;
  // A publish the provider rejected posted nothing, so it must not settle the
  // gate — the PR would be left with no walkthrough and no reminder that it is
  // owed one.
  if (callFailed(input)) return false;
  return collectPrPostText(cmd, input.cwd, read).includes(REPORT_SENTINEL);
}

/** Record a walkthrough post, returning the same reference when nothing changed so the caller can skip a redundant write. */
export function applyWalkthroughPosted(state: GuardrailState, posted: boolean): GuardrailState {
  if (!posted || state.walkthroughPosted === true) return state;
  return { ...state, walkthroughPosted: true };
}

/** Record a walkthrough skip, returning the same reference when nothing changed so the caller can skip a redundant write. */
export function applyWalkthroughSkip(state: GuardrailState, skipped: boolean): GuardrailState {
  if (!skipped || state.walkthroughSkipped === true) return state;
  return { ...state, walkthroughSkipped: true };
}
