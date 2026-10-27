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

  it("never gates a remote target", async () => {
    const { findRunStackRefusal } = await import("../mcp/local/services/run-stack-gate.js");
    const { claimServiceStack } = await import("../shared/service-stack/index.js");
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 443, runDir: "/wt/a/web" }], runGit: git });

    expect(await findRunStackRefusal({ cwd: "/wt/b", localUrl: "https://staging.example.com", runGit: git })).toBeNull();
  });
});
