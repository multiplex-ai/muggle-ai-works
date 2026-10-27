import { describe, it, expect } from "vitest";
import { applyStateMutation } from "../../guardrails/stateCommit.js";
import { E2eSkipCode } from "../../e2e-skip/types.js";
import { StateMutationKind, type GuardrailState, type StateMutation } from "../../guardrails/types.js";

const emptyState: GuardrailState = { sessionId: "s", prsHandled: [] };
const PR_URL = "https://github.com/o/r/pull/7";
const POSTED_AT = 1_700_000_000_000;
const treeChange = { repo: "github.com/o/r", branch: "feature" };

const toolOutcome: StateMutation = {
  kind: StateMutationKind.ToolOutcome,
  run: { unitTestPassed: false, e2eRan: true, e2eSkipped: false, e2eSkipCycleScoped: false },
  acceptedSkip: null,
  isWatchSkip: true,
  isBuildSkip: false,
  isWalkthroughPosted: true,
  walkthroughPostedAt: POSTED_AT,
  walkthroughPostTargets: [],
  isWalkthroughSkip: false,
  failedRunId: "run-1",
};

const declaredSkipOutcome: StateMutation = {
  kind: StateMutationKind.ToolOutcome,
  run: { unitTestPassed: false, e2eRan: false, e2eSkipped: true, e2eSkipCycleScoped: false },
  acceptedSkip: { code: E2eSkipCode.NoWebSurface, detail: "CLI-only change" },
  skipVerifiedChange: treeChange,
  isWatchSkip: false,
  isBuildSkip: false,
  isWalkthroughPosted: true,
  walkthroughPostedAt: POSTED_AT,
  walkthroughPostTargets: [PR_URL],
  isWalkthroughSkip: false,
};

const skillInvocation: StateMutation = {
  kind: StateMutationKind.SkillInvocation,
  skillName: "muggle-test",
  stagePaths: ["/skills/muggle-test/stage.md"],
  emittedRun: { unitTestPassed: false, e2eRan: true, e2eSkipped: false, e2eSkipCycleScoped: false },
};

const prOpened: StateMutation = { kind: StateMutationKind.PrOpened, prUrl: PR_URL, prChange: treeChange };

const delegation: StateMutation = {
  kind: StateMutationKind.E2eDelegation,
  delegation: { dispatchedAt: POSTED_AT, prUrls: [PR_URL] },
};

const watchFollowThrough: StateMutation = {
  kind: StateMutationKind.WatchFollowThrough,
  heldPrNumbers: [7],
  blockCount: 2,
};

describe("applyStateMutation", () => {
  // The post's time is the hook's, carried in the mutation, so a commit
  // deferred past a contended lock stamps the moment the post happened.
  it("folds a tool outcome's run, skip markers, posted walkthrough and failed run", () => {
    expect(applyStateMutation(emptyState, toolOutcome)).toEqual({
      ...emptyState,
      e2eRun: true,
      e2eBlockCount: 0,
      watchSkipped: true,
      walkthroughPostedAt: POSTED_AT,
      failedRuns: ["run-1"],
    });
  });

  it("keeps an accepted environment skip with the change it was verified for, and the PRs a post reached", () => {
    expect(applyStateMutation({ ...emptyState, prsHandled: [PR_URL] }, declaredSkipOutcome)).toMatchObject({
      e2eSkipped: true,
      e2eSkipDeclaration: { code: E2eSkipCode.NoWebSurface, detail: "CLI-only change" },
      e2eSkipVerifiedChange: treeChange,
      walkthroughPostedPrUrls: [PR_URL],
    });
  });

  it("records a skill, its mandatory stages and the run its emit stands for", () => {
    expect(applyStateMutation(emptyState, skillInvocation)).toMatchObject({
      lastInvokedSkillName: "muggle-test",
      mandatoryStages: ["/skills/muggle-test/stage.md"],
      e2eRun: true,
    });
  });

  it("records an opened PR's change and re-arms the walkthrough check for it", () => {
    const verified = { ...emptyState, walkthroughsVerified: true };
    expect(applyStateMutation(verified, prOpened)).toMatchObject({
      walkthroughsVerified: false,
      prChanges: { [PR_URL]: treeChange },
    });
  });

  it("records a background acceptance run at the time the hook saw its dispatch", () => {
    expect(applyStateMutation(emptyState, delegation).e2eDelegations).toEqual([
      { dispatchedAt: POSTED_AT, prUrls: [PR_URL] },
    ]);
  });

  it("records the user's holds and the follow-through block count", () => {
    expect(applyStateMutation(emptyState, watchFollowThrough)).toMatchObject({
      watchHeldPrNumbers: [7],
      watchFollowThroughBlockCount: 2,
    });
  });

  it("sets fields, returning the same reference when they already hold their values", () => {
    const stamped = applyStateMutation(emptyState, { kind: StateMutationKind.Fields, fields: { e2eReleased: true } });
    expect(stamped.e2eReleased).toBe(true);
    expect(applyStateMutation(stamped, { kind: StateMutationKind.Fields, fields: { e2eReleased: true } })).toBe(stamped);
  });

  // A deferred mutation is committed from its JSON file, so it must mean the same after the round trip.
  it.each([toolOutcome, declaredSkipOutcome, skillInvocation, prOpened, delegation, watchFollowThrough])(
    "applies the same after a round trip through JSON ($kind)",
    (mutation) => {
      const persisted = JSON.parse(JSON.stringify(mutation)) as StateMutation;
      const handled = { ...emptyState, prsHandled: [PR_URL] };
      expect(applyStateMutation(handled, persisted)).toEqual(applyStateMutation(handled, mutation));
    },
  );
});
