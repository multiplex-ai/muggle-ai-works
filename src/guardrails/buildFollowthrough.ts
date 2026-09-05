import { MAX_BUILD_BLOCKS } from "./constants.js";
import {
  BuildFollowthroughAction,
  type BuildFollowthroughDecision,
  type GuardrailState,
} from "./types.js";

// A deliberate "no PR owed for this build request" declaration: the model runs
// `echo "MUGGLE_BUILD_SKIP: <reason>"` and the gate stays quiet for the session
// (the user changed their mind, the work landed in another repo's PR, the answer
// turned out to be advice rather than a change). Anchored to a leading echo for
// the same reason the watcher and E2E skip markers are — a grep, commit, or
// skill edit that merely mentions the token must not disarm the gate.
const BUILD_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_BUILD_SKIP\b/;

/** Whether a Bash command is the explicit build-followthrough skip declaration. */
export function isBuildSkipMarker(cmd: string): boolean {
  return BUILD_SKIP_MARKER.test(cmd);
}

/** Record a build-followthrough skip into the gate state, returning the same reference when nothing changed so the caller can skip a redundant write. */
export function applyBuildSkip(state: GuardrailState, skipped: boolean): GuardrailState {
  if (!skipped || state.buildSkipped === true) return state;
  return { ...state, buildSkipped: true };
}

/**
 * Decide what the Stop hook does about an unanswered build request.
 *
 * `buildIntentRouted` is set by the front-door router the moment it offers
 * `/muggle-do` on a build/implement/fix prompt, so it marks a session the user
 * asked to change something in. `prsHandled` is the only durable evidence the
 * change was actually delivered — a diagnosis narrated into the transcript
 * leaves nothing behind once the session ends.
 *
 * The router's advisory was purely informational, and a session that found the
 * root cause could still end without shipping anything: observed 2026-09-04,
 * where a session root-caused a dashboard defect, wrote the fix into its final
 * message, and stopped. Nothing else catches that — the watcher gate only fires
 * once a PR exists, so a session that opens none clears every gate.
 *
 * Pure: the caller reads the state.
 * - `None`    — nothing owed (no build intent, a PR was handled, or a skip recorded).
 * - `Block`   — a build request went unanswered; force the turn on.
 * - `Release` — blocked `maxBlocks` times already; stop nagging so a request that
 *               legitimately resolves without a PR can't trap the session.
 */
export function buildFollowthroughDecision(
  state: GuardrailState,
  maxBlocks: number = MAX_BUILD_BLOCKS,
): BuildFollowthroughDecision {
  const blockCount = state.buildBlockCount ?? 0;
  const owed =
    state.buildIntentRouted === true &&
    state.buildSkipped !== true &&
    state.prsHandled.length === 0;
  if (!owed) return { action: BuildFollowthroughAction.None, blockCount: blockCount };
  if (blockCount >= maxBlocks) {
    return { action: BuildFollowthroughAction.Release, blockCount: blockCount };
  }
  return { action: BuildFollowthroughAction.Block, blockCount: blockCount + 1 };
}
