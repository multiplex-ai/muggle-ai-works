import { describe, it, expect } from "vitest";
import {
  isBuildSkipMarker,
  applyBuildSkip,
  buildFollowthroughDecision,
} from "../../guardrails/buildFollowthrough.js";
import { BuildFollowthroughAction, type GuardrailState } from "../../guardrails/types.js";

const base = (over: Partial<GuardrailState> = {}): GuardrailState => ({
  sessionId: "s",
  prsHandled: [],
  ...over,
});

describe("isBuildSkipMarker", () => {
  it("matches a leading MUGGLE_BUILD_SKIP echo", () => {
    expect(isBuildSkipMarker('echo "MUGGLE_BUILD_SKIP: user withdrew the request"')).toBe(true);
  });
  it("ignores the token when it is merely mentioned mid-command", () => {
    expect(isBuildSkipMarker('grep -r MUGGLE_BUILD_SKIP plugin/')).toBe(false);
    expect(isBuildSkipMarker('git commit -m "document MUGGLE_BUILD_SKIP"')).toBe(false);
  });
});

describe("applyBuildSkip", () => {
  it("returns the same reference when nothing changed, so the caller can skip the write", () => {
    const state = base();
    expect(applyBuildSkip(state, false)).toBe(state);
    const already = base({ buildSkipped: true });
    expect(applyBuildSkip(already, true)).toBe(already);
  });
  it("stamps the skip", () => {
    expect(applyBuildSkip(base(), true).buildSkipped).toBe(true);
  });
});

describe("buildFollowthroughDecision", () => {
  it("None when no build request was routed this session", () => {
    expect(buildFollowthroughDecision(base()).action).toBe(BuildFollowthroughAction.None);
  });
  it("None when a PR was opened, which is the evidence the request was answered", () => {
    const state = base({ buildIntentRouted: true, prsHandled: ["https://x/pull/1"] });
    expect(buildFollowthroughDecision(state).action).toBe(BuildFollowthroughAction.None);
  });
  it("None when a skip was recorded", () => {
    const state = base({ buildIntentRouted: true, buildSkipped: true });
    expect(buildFollowthroughDecision(state).action).toBe(BuildFollowthroughAction.None);
  });
  it("Block and increments the count when a build request shipped nothing", () => {
    const decision = buildFollowthroughDecision(base({ buildIntentRouted: true }));
    expect(decision.action).toBe(BuildFollowthroughAction.Block);
    expect(decision.blockCount).toBe(1);
  });
  it("Release after the block budget is spent, so a request that needs no PR can't trap the session", () => {
    const state = base({ buildIntentRouted: true, buildBlockCount: 3 });
    expect(buildFollowthroughDecision(state).action).toBe(BuildFollowthroughAction.Release);
  });
});
