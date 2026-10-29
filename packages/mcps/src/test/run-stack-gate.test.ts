/** Tests for the execute tools' service-stack gate. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitCommandRunner } from "../shared/checkout-freshness-types.js";

const HOME_ENV_VAR = os.platform() === "win32" ? "USERPROFILE" : "HOME";

let tempHome: string;
let savedHome: string | undefined;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-stack-gate-test-"));
  savedHome = process.env[HOME_ENV_VAR];
  process.env[HOME_ENV_VAR] = tempHome;
  vi.resetModules();
});

afterEach(() => {
  if (savedHome === undefined) {
    delete process.env[HOME_ENV_VAR];
  } else {
    process.env[HOME_ENV_VAR] = savedHome;
  }
  fs.rmSync(tempHome, { recursive: true, force: true });
});

const git: GitCommandRunner = async (args, cwd) => {
  if (args[1] === "--show-toplevel") return cwd;
  if (args[1] === "HEAD") return "a".repeat(40);
  return null;
};

describe("findRunStackRefusal", () => {
  it("lets a run through when nobody claimed the stack", async () => {
    const { findRunStackRefusal } = await import("../mcp/local/services/run-stack-gate.js");

    expect(await findRunStackRefusal({ cwd: "/wt/b", localUrl: "http://localhost:3000", runGit: git })).toBeNull();
  });

  it("refuses a run against a port a peer checkout leased", async () => {
    const { findRunStackRefusal } = await import("../mcp/local/services/run-stack-gate.js");
    const { claimServiceStack, StackCheckVerdict } = await import("../shared/service-stack/index.js");
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });

    const refusal = await findRunStackRefusal({ cwd: "/wt/b", localUrl: "http://localhost:3000/login", runGit: git });

    expect(refusal?.verdict).toBe(StackCheckVerdict.PeerLease);
  });

  it("refuses a run whose claimed port an untracked process holds", async () => {
    const { findRunStackRefusal } = await import("../mcp/local/services/run-stack-gate.js");
    const { claimServiceStack, StackCheckVerdict, StackMismatchKind } = await import("../shared/service-stack/index.js");
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3999, runDir: "/wt/a/web" }], runGit: git });

    const refusal = await findRunStackRefusal({
      cwd: "/wt/a",
      localUrl: "http://localhost:3999/muggleTestV0/landing",
      runGit: git,
      readListener: async () => ({
        isReadable: true,
        listener: { pid: 34016, commandLine: "node static_spa_server.cjs build-5277 3999", ancestorPids: [] },
      }),
    });

    expect(refusal?.verdict).toBe(StackCheckVerdict.Stale);
    expect(refusal?.mismatches[0].kind).toBe(StackMismatchKind.UntrackedListener);
  });

  it("refuses a run whose lease ended unused, and says to re-run prepare", async () => {
    const { findRunStackRefusal } = await import("../mcp/local/services/run-stack-gate.js");
    const { formatRunStackRefusal } = await import("../mcp/tools/local/run-stack-refusal.js");
    const { claimServiceStack, StackCheckVerdict } = await import("../shared/service-stack/index.js");
    const { SERVE_WINDOW_MS } = await import("../shared/service-stack/service-stack-constants.js");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3999, runDir: "/wt/a/web" }], runGit: git });
      vi.setSystemTime(Date.now() + SERVE_WINDOW_MS + 1);

      const refusal = await findRunStackRefusal({ cwd: "/wt/a", localUrl: "http://localhost:3999", runGit: git });

      expect(refusal?.verdict).toBe(StackCheckVerdict.Ended);
      expect(formatRunStackRefusal(refusal!, "/wt/a")).toContain("Re-run muggle-test-prepare");
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds the caller's lease only while the run is in flight", async () => {
    const { runUnderStackLease } = await import("../mcp/local/services/run-stack-gate.js");
    const { claimServiceStack, readServiceStackStatus } = await import("../shared/service-stack/index.js");
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3999, runDir: "/wt/a/web" }], runGit: git });

    const runsInFlight = await runUnderStackLease({
      cwd: "/wt/a",
      localUrl: "http://localhost:3999",
      runGit: git,
      execute: async () => (await readServiceStackStatus()).leases[0].activeRuns?.length,
    });
    const lease = (await readServiceStackStatus()).leases[0];

    expect(runsInFlight).toBe(1);
    expect(lease.activeRuns).toBeUndefined();
    expect(lease.lastRunEndedAt).toBeTypeOf("number");
    expect(lease.holderPids).toEqual([process.pid]);
  });

  it("records the run's end when the run throws, and rethrows", async () => {
    const { runUnderStackLease } = await import("../mcp/local/services/run-stack-gate.js");
    const { claimServiceStack, readServiceStackStatus } = await import("../shared/service-stack/index.js");
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3999, runDir: "/wt/a/web" }], runGit: git });

    await expect(
      runUnderStackLease({
        cwd: "/wt/a",
        localUrl: "http://localhost:3999",
        runGit: git,
        execute: async () => {
          throw new Error("electron crashed");
        },
      }),
    ).rejects.toThrow("electron crashed");
    expect((await readServiceStackStatus()).leases[0].activeRuns).toBeUndefined();
  });

  it("reads what a valid lease serves, and nothing for a remote target or a checkout with no lease", async () => {
    const { readServedStack } = await import("../mcp/local/services/run-stack-gate.js");
    const { claimServiceStack } = await import("../shared/service-stack/index.js");
    const unreadableListener = async () => ({ isReadable: false, listener: null });
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3999, runDir: "/wt/a/web" }], runGit: git });

    const served = await readServedStack({ cwd: "/wt/a", localUrl: "http://localhost:3999", runGit: git, readListener: unreadableListener });

    expect(served).toHaveLength(1);
    expect(served[0]).toMatchObject({ port: 3999, headSha: "a".repeat(40) });
    expect(await readServedStack({ cwd: "/wt/a", localUrl: "https://staging.example.com", runGit: git })).toEqual([]);
    expect(await readServedStack({ cwd: "/wt/b", localUrl: "http://localhost:3000", runGit: git, readListener: unreadableListener })).toEqual([]);
  });

  it("stamps a run with its stack only when the stack held through the run", async () => {
    const { recordServedStack } = await import("../mcp/local/services/run-stack-gate.js");
    const { getRunResultStorageService } = await import("../mcp/local/services/run-result-storage-service.js");
    const { StackCheckVerdict } = await import("../shared/service-stack/index.js");
    const storage = getRunResultStorageService();
    const newRun = () =>
      storage.createRunResult({
        runType: "replay",
        cloudTestCaseId: "tc-1",
        projectId: "p-1",
        useCaseId: "uc-1",
        localUrl: "http://localhost:3999",
        productionUrl: "https://example.com",
        localExecutionContext: { originalUrl: "http://localhost:3999", productionUrl: "https://example.com", runByUserId: "u-1" },
      });
    const servedStack = [{ port: 3999, runDir: "/wt/a/web", headSha: "a".repeat(40) }];
    const staleReport = {
      verdict: StackCheckVerdict.Stale,
      cwd: "/wt/a",
      reason: "moved",
      generation: 2,
      mismatches: [],
      peerLease: null,
      servedNeeds: [],
    };
    const held = newRun();
    const moved = newRun();
    const unproven = newRun();

    recordServedStack({ runId: held.id, servedStack: servedStack, stackChange: null });
    recordServedStack({ runId: moved.id, servedStack: servedStack, stackChange: staleReport });
    recordServedStack({ runId: unproven.id, servedStack: [], stackChange: null });
    recordServedStack({ runId: "missing-run", servedStack: servedStack, stackChange: null });

    expect(storage.getRunResult(held.id)?.localExecutionContext).toMatchObject({ runByUserId: "u-1", servedStack: servedStack });
    expect(storage.getRunResult(moved.id)?.localExecutionContext.servedStack).toBeUndefined();
    expect(storage.getRunResult(unproven.id)?.localExecutionContext.servedStack).toBeUndefined();
  });

  it("never gates a remote target", async () => {
    const { findRunStackRefusal } = await import("../mcp/local/services/run-stack-gate.js");
    const { claimServiceStack } = await import("../shared/service-stack/index.js");
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 443, runDir: "/wt/a/web" }], runGit: git });

    expect(await findRunStackRefusal({ cwd: "/wt/b", localUrl: "https://staging.example.com", runGit: git })).toBeNull();
  });
});
