/** Tests for the `muggle stack` CLI helpers. */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildStackWaitCommand,
  parseStackNeed,
  renderStackClaimSummary,
  renderStackReleaseSummary,
  renderStackStatusSummary,
  stackClaimCommand,
} from "../../cli/service-stack";
import { STACK_WAIT_SECONDS } from "../../cli/service-stack-constants";
import { BUSY_EXIT_CODE, claimServiceStack, StackClaimVerdict, StackPortAction, type IStackClaimReport } from "@muggleai/mcp";

vi.mock("@muggleai/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@muggleai/mcp")>()),
  claimServiceStack: vi.fn(),
}));

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
    stoppedServices: [],
  };

  it("names each service a claim stopped because no lease needed it", () => {
    const summary = renderStackClaimSummary({
      ...base,
      stoppedServices: [{ port: 3999, pid: 4410, name: "muggle-ai-ui-dashboard", commandLine: "node serve build 3999" }],
    });
    expect(summary).toContain("stopped 3999: muggle-ai-ui-dashboard (PID 4410)");
  });

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

  it("hands a busy claim the background wait that wakes it on the grant", () => {
    const waitCommand = buildStackWaitCommand({ cwd: "/wt/a", needs: ["3000=/wt/a/web"] });
    const summary = renderStackClaimSummary({ ...base, verdict: StackClaimVerdict.Busy, position: 1, queueLength: 1 }, waitCommand);
    expect(summary).toContain(`or wait in the background; it exits once the stack is yours: ${waitCommand}`);
  });
});

describe("buildStackWaitCommand", () => {
  it("re-states the claim with a bounded wait, quoting a Windows path and a label with an apostrophe", () => {
    const waitCommand = buildStackWaitCommand({
      cwd: "C:\\wt\\a",
      label: "stan's fix",
      needs: ["3000=C:\\wt\\a\\web", "8080=C:\\base\\api@abc1234"],
    });
    expect(waitCommand).toBe(
      `muggle stack claim --cwd 'C:\\wt\\a' --label 'stan'\\''s fix' --need '3000=C:\\wt\\a\\web' ` +
        `--need '8080=C:\\base\\api@abc1234' --wait ${STACK_WAIT_SECONDS} --json`,
    );
  });
});

describe("stackClaimCommand", () => {
  const busyReport: IStackClaimReport = {
    verdict: StackClaimVerdict.Busy,
    cwd: "/wt/a",
    generation: 3,
    plan: [],
    blockers: [],
    sharedWith: [],
    position: 2,
    queueLength: 2,
    retryAfterMs: 30_000,
    stoppedServices: [],
  };

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  async function printedClaim(report: IStackClaimReport): Promise<Record<string, unknown>> {
    vi.mocked(claimServiceStack).mockResolvedValue(report);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await stackClaimCommand({ cwd: "/wt/a", label: "feat-x", need: ["3000=/wt/a/web"], json: true });
    return JSON.parse(String(write.mock.calls[0][0])) as Record<string, unknown>;
  }

  it("prints the background wait in the JSON a busy claim answers with, so the caller can be woken on its turn", async () => {
    const printed = await printedClaim(busyReport);
    expect(printed.waitCommand).toBe(buildStackWaitCommand({ cwd: "/wt/a", label: "feat-x", needs: ["3000=/wt/a/web"] }));
    expect(process.exitCode).toBe(BUSY_EXIT_CODE);
  });

  it("prints no wait for a granted claim", async () => {
    const printed = await printedClaim({ ...busyReport, verdict: StackClaimVerdict.Granted, position: null });
    expect(printed).not.toHaveProperty("waitCommand");
  });
});

describe("renderStackStatusSummary", () => {
  it("shows what ranks each waiting checkout: its open pull request, or none", () => {
    const now = Date.now();
    const summary = renderStackStatusSummary({
      generation: 9,
      leases: [],
      services: [],
      queue: [
        {
          cwd: "/wt/a",
          label: "agent-a",
          needs: [{ port: 3999, runDir: "/wt/a/web", headSha: "a".repeat(40) }],
          pullRequest: { number: 709, url: "", createdAt: now - 3 * 60 * 60_000 },
          enqueuedAt: now,
          lastSeenAt: now,
        },
        { cwd: "/wt/b", needs: [{ port: 3999, runDir: "/wt/b/web", headSha: "b".repeat(40) }], enqueuedAt: now, lastSeenAt: now },
      ],
    });

    expect(summary).toContain("waiting 1: agent-a — port 3999, PR #709 opened 180m ago");
    expect(summary).toContain("waiting 2: /wt/b — port 3999, no open PR");
  });
});

describe("renderStackReleaseSummary", () => {
  it("lists the untracked listeners a release stopped by their command line", () => {
    const summary = renderStackReleaseSummary({
      isReleased: true,
      stoppedServices: [{ port: 5054, pid: 7712, name: null, commandLine: "node dist/server.js" }],
    });
    expect(summary).toBe("released\nstopped 5054: node dist/server.js (PID 7712) — no lease needs it any more");
  });
});
