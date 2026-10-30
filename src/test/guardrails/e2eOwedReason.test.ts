import { describe, it, expect } from "vitest";
import { buildE2eOwedReason } from "../../guardrails/e2eOwedReason.js";
import { E2eSkipCode } from "../../e2e-skip/types.js";
import type { E2eOwedReasonInput } from "../../guardrails/types.js";

const reasonInput = (overrides: Partial<E2eOwedReasonInput>): E2eOwedReasonInput => ({
  blockCount: 1,
  maxBlocks: 3,
  autoE2ETest: "always",
  postPRVisualWalkthrough: "always",
  isE2eMandatedByUser: true,
  muggleTestSkill: "/muggle:muggle-test",
  walkthroughSkill: "/muggle:muggle-pr-visual-walkthrough",
  ...overrides,
});

describe("buildE2eOwedReason", () => {
  it("treats autoE2ETest=always as the user's answer: no asking, the walkthrough owed, no judgment escape", () => {
    const reason = buildE2eOwedReason(reasonInput({}));
    expect(reason).toContain("autoE2ETest=always, postPRVisualWalkthrough=always");
    expect(reason).toContain("do not ask them whether to test");
    expect(reason).toContain("do not end the turn handing the decision back");
    expect(reason).toContain("/muggle:muggle-test, then post the run's walkthrough to the PR via /muggle:muggle-pr-visual-walkthrough");
    expect(reason).toContain("MUGGLE_E2E_SKIP");
    expect(reason).not.toContain(E2eSkipCode.NotApplicable);
  });

  it("keeps the unverified-judgment skip for a preference that is not always", () => {
    const reason = buildE2eOwedReason(reasonInput({ autoE2ETest: "ask", postPRVisualWalkthrough: undefined, isE2eMandatedByUser: false }));
    expect(reason).toContain("autoE2ETest=ask, postPRVisualWalkthrough=unset");
    expect(reason).toContain(E2eSkipCode.NotApplicable);
    expect(reason).not.toContain("muggle-pr-visual-walkthrough");
  });

  it("words a repeat as one reminder line that still names the preferences", () => {
    const first = buildE2eOwedReason(reasonInput({}));
    const repeat = buildE2eOwedReason(reasonInput({ blockCount: 2 }));
    expect(repeat).toContain("reminder 2/3");
    expect(repeat).toContain("autoE2ETest=always");
    expect(repeat.length).toBeLessThan(first.length);
  });
});
