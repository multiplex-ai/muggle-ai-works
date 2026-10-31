import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readdirSync, unlinkSync, writeFileSync } from "fs";
import { hostname, tmpdir } from "os";
import { join } from "path";
import { applyStateMutation, commitStateMutation } from "../../guardrails/stateCommit.js";
import { commitState, readState } from "../../guardrails/sessionState.js";
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

const prTerminal: StateMutation = { kind: StateMutationKind.PrTerminal, prNumber: 7 };
const prReopened: StateMutation = { kind: StateMutationKind.PrReopened, prNumber: 7 };
const nextOptionsOffered: StateMutation = { kind: StateMutationKind.NextOptionsOffered };
const STAGE_PATH = "/skills/muggle-do/stage.md";
const stageReads: StateMutation = { kind: StateMutationKind.StageReads, readPaths: [STAGE_PATH] };

const stageSignals: StateMutation = {
  kind: StateMutationKind.StageSignals,
  isStageSkip: true,
  isClassificationSkip: false,
  debugSkipCommand: 'echo "MUGGLE_DEBUG_SKIP: run-1 studio crashed before any screenshot"',
  classifiedTestCaseId: "tc-1",
  debugEvidenceRunIds: ["run-2"],
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

  it("drops the previous declaration's change when a new skip's change went unresolved", () => {
    const prOfTreeChange = { ...emptyState, prsHandled: [PR_URL], prChanges: { [PR_URL]: treeChange } };
    const earlierSkip = applyStateMutation(prOfTreeChange, declaredSkipOutcome);
    const unresolvedSkip = applyStateMutation(earlierSkip, { ...declaredSkipOutcome, skipVerifiedChange: undefined });
    expect(unresolvedSkip.e2eSkipVerifiedChange).toBeUndefined();
    expect(unresolvedSkip.e2eSkipCoveredPrs).toEqual([PR_URL]);
  });

  it("keeps the declaration's change through a cycle-scoped skip", () => {
    const earlierSkip = applyStateMutation(emptyState, declaredSkipOutcome);
    const cycleSkip = applyStateMutation(earlierSkip, {
      ...declaredSkipOutcome,
      run: { ...declaredSkipOutcome.run, e2eSkipCycleScoped: true },
      acceptedSkip: { code: E2eSkipCode.NoAppLogicChange, detail: "abc..def docs only" },
      skipVerifiedChange: undefined,
    });
    expect(cycleSkip.e2eSkipVerifiedChange).toEqual(treeChange);
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

  it("records an opened PR as handled once", () => {
    const opened = applyStateMutation(emptyState, prOpened);
    expect(opened.prsHandled).toEqual([PR_URL]);
    expect(applyStateMutation(opened, prOpened).prsHandled).toEqual([PR_URL]);
  });

  it("arms the post-merge handoff for a terminal PR, the same reference once it is armed", () => {
    const armed = applyStateMutation(emptyState, prTerminal);
    expect(armed.terminalPending).toEqual([7]);
    expect(applyStateMutation(armed, prTerminal)).toBe(armed);
  });

  it("retracts the handoff of a reopened PR", () => {
    const armed = applyStateMutation(emptyState, prTerminal);
    expect(applyStateMutation(armed, prReopened)).toMatchObject({ terminalPending: [], terminalHandled: [] });
  });

  it("hands every pending terminal PR off when the next options are offered", () => {
    const armed = { ...applyStateMutation(emptyState, prTerminal), terminalBlockCount: 2 };
    expect(applyStateMutation(armed, nextOptionsOffered)).toMatchObject({
      terminalPending: [],
      terminalHandled: [7],
      terminalBlockCount: 0,
    });
  });

  it("records each stage read, the same reference once every one is recorded", () => {
    const read = applyStateMutation(emptyState, stageReads);
    expect(read.stagesRead).toEqual([STAGE_PATH]);
    expect(applyStateMutation(read, stageReads)).toBe(read);
  });

  // The debug skip names its run against the committed state, so a failure
  // recorded after the hook read the state is still the one it clears.
  it("folds a call's stage skip, debug skip, classification and debug evidence", () => {
    const failing = { ...emptyState, failedRuns: ["run-1", "run-2"] };
    expect(applyStateMutation(failing, stageSignals)).toMatchObject({
      stageSkipped: true,
      classifiedTestCaseIds: ["tc-1"],
      debuggedRuns: ["run-1", "run-2"],
    });
  });

  it("leaves the state untouched when a call carried no stage signal", () => {
    const silent: StateMutation = {
      kind: StateMutationKind.StageSignals,
      isStageSkip: false,
      isClassificationSkip: false,
      debugEvidenceRunIds: [],
    };
    expect(applyStateMutation(emptyState, silent)).toBe(emptyState);
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
  it.each([
    toolOutcome,
    declaredSkipOutcome,
    skillInvocation,
    prOpened,
    prTerminal,
    prReopened,
    nextOptionsOffered,
    delegation,
    watchFollowThrough,
    stageReads,
    stageSignals,
  ])("applies the same after a round trip through JSON ($kind)", (mutation) => {
    const persisted = JSON.parse(JSON.stringify(mutation)) as StateMutation;
    const handled = { ...emptyState, prsHandled: [PR_URL], failedRuns: ["run-1"], terminalPending: [7] };
    expect(applyStateMutation(handled, persisted)).toEqual(applyStateMutation(handled, mutation));
  });
});

describe("commitStateMutation with the state the hook read", () => {
  let stateDir: string;
  beforeEach(() => {
    const home = mkdtempSync(join(tmpdir(), "gr-observed-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    stateDir = join(home, ".muggle-ai", "guardrails");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // A recorder fires on most tool calls and usually has nothing new to record,
  // so its no-op must not wait on, or defer behind, another hook's lock.
  it("takes no lock and writes nothing when the mutation leaves that state unchanged", () => {
    commitState("s", (state) => ({ ...state, stagesRead: [STAGE_PATH] }), stateDir);
    const observed = readState("s", stateDir);
    const lockFile = join(stateDir, "s.json.lock");
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, host: hostname(), acquiredAt: new Date().toISOString() }));
    try {
      expect(commitStateMutation("s", stageReads, observed)).toBe(observed);
      expect(readdirSync(stateDir).filter((name) => name.includes(".deferred-"))).toEqual([]);
    } finally {
      unlinkSync(lockFile);
    }
  });

  // The state the hook read is only the cheap check; what lands is the mutation
  // over the committed state, so a write another hook made since survives it.
  it("commits over the committed state, keeping a write made after the hook read", () => {
    const observed = readState("s", stateDir);
    commitState("s", (state) => ({ ...state, unitTestsGreen: true }), stateDir);
    expect(commitStateMutation("s", stageReads, observed)).toMatchObject({ unitTestsGreen: true, stagesRead: [STAGE_PATH] });
    expect(readState("s", stateDir)).toMatchObject({ unitTestsGreen: true, stagesRead: [STAGE_PATH] });
  });
});
