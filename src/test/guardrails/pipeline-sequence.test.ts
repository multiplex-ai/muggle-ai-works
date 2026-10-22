import { beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import type { GuardrailHookOutput } from "../../guardrails/types.js";
import { HookEvent } from "./footprint/types.js";
import { SILENT_HOOK_OUTPUT } from "./hook-harness/constants.js";
import { guardrailSubcommandsForSlot } from "./hook-harness/hookHarness.js";
import {
  FORWARD_STAGE_FILES,
  FULL_HANDOFF_SEQUENCE,
  GATE_SETTLE_POLL_MS,
  GATE_SETTLE_TIMEOUT_MS,
  HANDOFF_CASE_TIMEOUT_MS,
  PLUGIN_SKILLS_ROOT,
  PROVIDER_DEPENDENT_STOP_GATES,
  SHARED_REPLAY_TIMEOUT_MS,
  STOP_GATE_SKIP_MARKERS,
} from "./handoff-replay/constants.js";
import {
  cloneHandoffSession,
  createHandoffSession,
  fireStopGates,
  replayHandoffSteps,
  sharedStepPrefix,
  withoutStep,
  withStepReplaced,
} from "./handoff-replay/handoffReplay.js";
import {
  HandoffStep,
  HandoffStopGate,
  type HandoffReplayCase,
  type HandoffSession,
  type ReplayedHookAnswer,
} from "./handoff-replay/types.js";

// The deterministic companion to the muggle-do handoff eval. One synthetic session is replayed through every hook
// hooks.json registers, the way Claude Code fires them: the full handoff leaves every Stop gate silent, and taking
// out one step makes exactly the gate that step satisfies block. A case whose gate decides on a provider lookup
// needs a POSIX `gh` stub, so it is skipped on win32 and covered by the Linux/macOS jobs.
const HANDOFF_CASES: HandoffReplayCase[] = [
  {
    label: "the full handoff leaves every Stop gate silent",
    steps: [...FULL_HANDOFF_SEQUENCE],
  },
  {
    label: "a verified NO_WEB_SURFACE skip in place of the E2E run leaves every Stop gate silent",
    steps: withStepReplaced(FULL_HANDOFF_SEQUENCE, HandoffStep.E2eExecution, HandoffStep.E2eSkipDeclaration),
  },
  {
    label: "no E2E run blocks on the E2E gate alone",
    steps: withoutStep(FULL_HANDOFF_SEQUENCE, HandoffStep.E2eExecution),
    blockingGate: HandoffStopGate.E2e,
  },
  {
    label: "no walkthrough post blocks on the walkthrough gate alone",
    steps: withoutStep(FULL_HANDOFF_SEQUENCE, HandoffStep.WalkthroughPost),
    blockingGate: HandoffStopGate.Walkthrough,
  },
  {
    label: "no watcher handoff (no slot, no armed watch) blocks on the watch gate alone",
    steps: withoutStep(FULL_HANDOFF_SEQUENCE, HandoffStep.WatcherHandoff),
    blockingGate: HandoffStopGate.Watch,
  },
];

const parseHookOutput = (stdout: string): GuardrailHookOutput => JSON.parse(stdout) as GuardrailHookOutput;

// A tool call a PreToolUse gate denies never runs, so a replay that draws a denial is not the handoff it claims to be.
function expectUnobjectedReplay(answers: ReplayedHookAnswer[]): void {
  for (const answer of answers) {
    expect(answer.status, answer.eventLabel).toBe(0);
    const hookOutput = parseHookOutput(answer.stdout);
    expect(hookOutput.decision, answer.eventLabel).not.toBe("block");
    expect(hookOutput.hookSpecificOutput?.permissionDecision, answer.eventLabel).not.toBe("deny");
  }
}

describe("muggle-do handoff replayed through every guardrail hook", () => {
  const stopGates = guardrailSubcommandsForSlot({ event: HookEvent.Stop });
  const sharedSteps = sharedStepPrefix(HANDOFF_CASES.map((handoffCase) => handoffCase.steps));
  let sharedSession: HandoffSession;

  // The steps every case opens with start no background job, so they are replayed once and each case continues
  // from a copy of the session they leave.
  beforeAll(() => {
    sharedSession = createHandoffSession();
    expectUnobjectedReplay(replayHandoffSteps(sharedSession, sharedSteps));
  }, SHARED_REPLAY_TIMEOUT_MS);

  it("reads stage files that exist, and fires a Stop gate for every gate a case names", () => {
    for (const relativePath of FORWARD_STAGE_FILES) {
      expect(existsSync(join(PLUGIN_SKILLS_ROOT, relativePath)), relativePath).toBe(true);
    }
    for (const handoffCase of HANDOFF_CASES) {
      if (handoffCase.blockingGate) expect(stopGates).toContain(handoffCase.blockingGate);
    }
  });

  for (const handoffCase of HANDOFF_CASES) {
    const blockingGate = handoffCase.blockingGate;
    const needsGhStub = blockingGate !== undefined && PROVIDER_DEPENDENT_STOP_GATES.includes(blockingGate);

    it.skipIf(needsGhStub && process.platform === "win32")(
      handoffCase.label,
      async () => {
        const session = cloneHandoffSession(sharedSession);
        expectUnobjectedReplay(replayHandoffSteps(session, handoffCase.steps.slice(sharedSteps.length)));

        const silentGates = stopGates.filter((stopGate) => stopGate !== blockingGate);
        expect(fireStopGates(session, silentGates).stdout).toBe(SILENT_HOOK_OUTPUT);
        if (blockingGate === undefined) return;

        // The walkthrough gate decides on a provider scan it runs detached, and stays open until one lands for
        // the session's PRs, so the turn end is retried until the gate has something to decide on.
        const blocked = await vi.waitFor(
          () => {
            const hookOutput = parseHookOutput(fireStopGates(session, [blockingGate]).stdout);
            expect(hookOutput.decision).toBe("block");
            return hookOutput;
          },
          { timeout: GATE_SETTLE_TIMEOUT_MS, interval: GATE_SETTLE_POLL_MS },
        );
        expect(blocked.reason).toContain(STOP_GATE_SKIP_MARKERS[blockingGate]);
      },
      HANDOFF_CASE_TIMEOUT_MS,
    );
  }
});
