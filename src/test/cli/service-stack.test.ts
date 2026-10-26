/** Tests for the `muggle stack` CLI helpers. */

import { describe, expect, it } from "vitest";

import { parseStackNeed, renderStackClaimSummary } from "../../cli/service-stack";
import { StackClaimVerdict, StackPortAction, type IStackClaimReport } from "@muggleai/mcp";

describe("parseStackNeed", () => {
  it("reads a port and run directory", () => {
    expect(parseStackNeed("3000=/repo/web")).toEqual({ port: 3000, runDir: "/repo/web", headSha: undefined });
  });

  it("reads an explicit commit", () => {
    expect(parseStackNeed("8080=/repo/api@abc1234")).toEqual({ port: 8080, runDir: "/repo/api", headSha: "abc1234" });
  });

  it("rejects a value without a port", () => {
    expect(() => parseStackNeed("/repo/web")).toThrow(/<port>=<run-dir>/);
  });
});

describe("renderStackClaimSummary", () => {
  const base: IStackClaimReport = {
    verdict: StackClaimVerdict.Granted,
    cwd: "/wt/a",
    generation: 3,
    plan: [],
    blockers: [],
    sharedWith: [],
    position: null,
    queueLength: 0,
    retryAfterMs: null,
  };

  it("lists what to do with each port when granted", () => {
    const summary = renderStackClaimSummary({
      ...base,
      plan: [{ port: 3000, runDir: "/wt/a/web", headSha: "a".repeat(40), action: StackPortAction.Start, current: null }],
    });
    expect(summary).toContain("start 3000: /wt/a/web @ aaaaaaa");
  });

  it("names the holder and the place in line when busy", () => {
    const summary = renderStackClaimSummary({
      ...base,
      verdict: StackClaimVerdict.Busy,
      position: 2,
      queueLength: 3,
      retryAfterMs: 30_000,
      blockers: [
        {
          port: 3000,
          blockingCwd: "/wt/b",
          blockingLabel: "agent-b",
          isQueuedAhead: false,
          needsRunDir: "/wt/b/web",
          needsHeadSha: "b".repeat(40),
          heldForMs: 90_000,
        },
      ],
    });
    expect(summary).toContain("place 2 of 3 in line");
    expect(summary).toContain("port 3000: agent-b (/wt/b) holds /wt/b/web @ bbbbbbb (for 90s)");
  });
});
