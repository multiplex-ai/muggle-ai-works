import {
  clearE2eShellBlocks,
  commitDeferredStateMutations,
  commitState,
  deferStateMutation,
  readState,
} from "./sessionState.js";
import { startBackgroundJob } from "./backgroundJob.js";
import { applyE2eSkipDeclaration, applyRecordedRun } from "./shouldRunE2E.js";
import { applyE2eSkipScope, applyPrOpenedToSkipScope } from "./skipScope.js";
import { applyWatchSkip } from "./watchArmed.js";
import { applyBuildSkip } from "./buildFollowthrough.js";
import { applyWalkthroughPosted, applyWalkthroughSkip } from "./walkthroughPosted.js";
import { applyPrOpenedToWalkthroughs } from "./walkthroughOwed.js";
import { applyE2eDelegation } from "./delegatedE2e.js";
import { applyWatchHolds } from "./watchFollowThrough.js";
import { applyDebugEvidence, applyDebugSkip, applyFailedRun } from "./debugPath.js";
import {
  applyDeclaredStages,
  applySkillInvocation,
  applyStageRead,
  applyStageSkip,
  resolveRouteStagePaths,
} from "./mandatoryStages.js";
import { applyNextOptionsOffered, applyPrReopened, applyPrTerminalDetected } from "./prTerminal.js";
import { applyClassificationSkip, applyClassifiedTestCase } from "./preExecutionClassification.js";
import {
  GuardrailBackgroundJob,
  StateMutationKind,
  type GuardrailState,
  type StageSignalsMutation,
  type StateMutation,
  type ToolOutcomeMutation,
} from "./types.js";

function applyToolOutcome(state: GuardrailState, outcome: ToolOutcomeMutation): GuardrailState {
  const declared = applyE2eSkipDeclaration(applyRecordedRun(state, outcome.run), outcome.acceptedSkip);
  const recorded = applyE2eSkipScope(declared, outcome.skipVerifiedChange);
  const withWatchSkip = applyWatchSkip(recorded, outcome.isWatchSkip);
  const withBuildSkip = applyBuildSkip(withWatchSkip, outcome.isBuildSkip);
  const withWalkthroughPost = applyWalkthroughPosted(
    withBuildSkip,
    outcome.isWalkthroughPosted,
    outcome.walkthroughPostedAt,
    outcome.walkthroughPostTargets,
  );
  const withWalkthroughSkip = applyWalkthroughSkip(withWalkthroughPost, outcome.isWalkthroughSkip);
  return outcome.failedRunId ? applyFailedRun(withWalkthroughSkip, outcome.failedRunId) : withWalkthroughSkip;
}

function applyStageSignals(state: GuardrailState, signals: StageSignalsMutation): GuardrailState {
  const withStageSkip = applyStageSkip(state, signals.isStageSkip);
  const withClassificationSkip = applyClassificationSkip(withStageSkip, signals.isClassificationSkip);
  const withDebugSkip = applyDebugSkip(withClassificationSkip, signals.debugSkipCommand ?? "");
  const withClassification = signals.classifiedTestCaseId
    ? applyClassifiedTestCase(withDebugSkip, signals.classifiedTestCaseId)
    : withDebugSkip;
  return applyDebugEvidence(withClassification, signals.debugEvidenceRunIds);
}

function applyPrHandled(state: GuardrailState, prUrl: string): GuardrailState {
  return state.prsHandled.includes(prUrl) ? state : { ...state, prsHandled: [...state.prsHandled, prUrl] };
}

// Same reference when every field already holds its value, so a gate that is
// already stamped does not rewrite the state the hook pre-filters read.
function applyFields(state: GuardrailState, fields: Partial<GuardrailState>): GuardrailState {
  const isUnchanged = Object.entries(fields).every(
    ([field, value]) => state[field as keyof GuardrailState] === value,
  );
  return isUnchanged ? state : { ...state, ...fields };
}

/** Fold one recorded change into the session state, returning the same reference when it changes nothing. */
export function applyStateMutation(state: GuardrailState, mutation: StateMutation): GuardrailState {
  switch (mutation.kind) {
    case StateMutationKind.ToolOutcome:
      return applyToolOutcome(state, mutation);
    case StateMutationKind.SkillInvocation:
      return applyRecordedRun(applySkillInvocation(state, mutation.skillName, mutation.stagePaths), mutation.emittedRun);
    case StateMutationKind.PrOpened:
      return applyPrOpenedToSkipScope(
        applyPrOpenedToWalkthroughs(applyPrHandled(state, mutation.prUrl)),
        mutation.prUrl,
        mutation.prChange,
      );
    case StateMutationKind.PrTerminal:
      return applyPrTerminalDetected(state, mutation.prNumber);
    case StateMutationKind.PrReopened:
      return applyPrReopened(state, mutation.prNumber);
    case StateMutationKind.NextOptionsOffered:
      return applyNextOptionsOffered(state);
    case StateMutationKind.E2eDelegation:
      return applyE2eDelegation(state, mutation.delegation);
    case StateMutationKind.WatchFollowThrough:
      return { ...applyWatchHolds(state, mutation.heldPrNumbers), watchFollowThroughBlockCount: mutation.blockCount };
    case StateMutationKind.StageReads: {
      const withReads = mutation.readPaths.reduce(applyStageRead, state);
      const skillsRootDir = mutation.skillsRootDir;
      if (!skillsRootDir) return withReads;
      // A route entry file read while a skill runs declares that route's stages; resolved under the lock with the reads.
      const routeStagePaths = mutation.readPaths.flatMap((readPath) => resolveRouteStagePaths(withReads, readPath, skillsRootDir));
      return applyDeclaredStages(withReads, routeStagePaths);
    }
    case StateMutationKind.StageSignals:
      return applyStageSignals(state, mutation);
    case StateMutationKind.Fields:
      return applyFields(state, mutation.fields);
  }
}

/**
 * Commit `mutation` to the session's state and return the state the hook acts on.
 *
 * A hook that cannot take the lock within its wait persists the mutation and
 * starts a detached commit that waits for the lock off the hook path, so
 * contention delays the record instead of losing it while both hooks exit clean.
 * The returned state is then the mutation over the latest committed state.
 *
 * @param observedState The state the hook already read. When the mutation leaves it unchanged, nothing is locked or
 *   written and `observedState` itself is returned, so a recorder's no-op path costs no more than its read.
 */
export function commitStateMutation(
  sessionId: string,
  mutation: StateMutation,
  observedState?: GuardrailState,
): GuardrailState {
  if (observedState && applyStateMutation(observedState, mutation) === observedState) return observedState;
  const committed = commitState(sessionId, (state) => applyStateMutation(state, mutation));
  if (committed) return withShellBlocksReset(committed);
  deferStateMutation(sessionId, mutation);
  startBackgroundJob(GuardrailBackgroundJob.CommitDeferredState, [sessionId]);
  return withShellBlocksReset(applyStateMutation(readState(sessionId), mutation));
}

// A registered E2E run rewinds `e2eBlockCount` (applyRecordedRun); the shell's
// share of the same budget lives beside the state and rewinds with it.
function withShellBlocksReset(state: GuardrailState): GuardrailState {
  if (state.e2eRun === true) clearE2eShellBlocks(state.sessionId);
  return state;
}

/** Commit every mutation the session's hooks deferred, for the detached job `commitStateMutation` starts. */
export function commitDeferredSessionState(sessionId: string): void {
  commitDeferredStateMutations(sessionId, applyStateMutation);
}
