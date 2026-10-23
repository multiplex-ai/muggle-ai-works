/** Tests for the local-run checkout gate and its wiring into the execute tools. */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { CheckoutFreshnessVerdict, type ICheckoutFreshnessReport } from "../shared/checkout-freshness.js";

vi.mock("../shared/config.js", () => ({
  getConfig: () => ({
    logLevel: "silent",
    serverName: "test",
    serverVersion: "0.0.0",
    e2e: { promptServiceBaseUrl: "http://test.invalid", requestTimeoutMs: 1000, workflowTimeoutMs: 1000 },
  }),
  getDashboardBaseUrl: () => "https://staging.muggle-ai.com/muggleTestV0/dashboard/projects",
}));

vi.mock("../shared/logger.js", () => {
  const noop = () => undefined;
  const fakeLogger = { info: noop, warn: noop, error: noop, debug: noop, verbose: noop, silly: noop, child: () => fakeLogger };
  return { getLogger: () => fakeLogger, createChildLogger: () => fakeLogger, resetLogger: noop };
});

const { mockFindRunCheckoutRefusal, mockExecuteTestGeneration, mockExecuteReplay } = vi.hoisted(() => ({
  mockFindRunCheckoutRefusal: vi.fn(),
  mockExecuteTestGeneration: vi.fn(),
  mockExecuteReplay: vi.fn(),
}));

vi.mock("../mcp/local/services/index.js", async () => {
  const gate = await vi.importActual<typeof import("../mcp/local/services/run-checkout-gate.js")>(
    "../mcp/local/services/run-checkout-gate.js",
  );
  return {
    cancelExecution: vi.fn(),
    executeReplay: mockExecuteReplay,
    executeTestGeneration: mockExecuteTestGeneration,
    findRunCheckoutRefusal: mockFindRunCheckoutRefusal,
    formatRunCheckoutRefusal: gate.formatRunCheckoutRefusal,
    getAuthService: () => ({ getAuthStatus: () => ({ authenticated: true }) }),
    getStorageService: () => ({ getDataDir: () => "/tmp", getSessionsDir: () => "/tmp" }),
    getRunResultStorageService: () => ({ getRunResult: vi.fn(), getTestScript: vi.fn() }),
  };
});

import {
  findRunCheckoutRefusal,
  formatRunCheckoutRefusal,
  isLoopbackUrl,
} from "../mcp/local/services/run-checkout-gate.js";
import { getTool } from "../mcp/tools/local/tool-registry.js";

const CWD = "/work/repo/.claude/worktrees/change";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const USE_CASE_ID = "22222222-2222-4222-8222-222222222222";
const TEST_CASE_ID = "33333333-3333-4333-8333-333333333333";
const TEST_SCRIPT_ID = "44444444-4444-4444-8444-444444444444";
const ACTION_SCRIPT_ID = "55555555-5555-4555-8555-555555555555";

const BEHIND_REPORT: ICheckoutFreshnessReport = {
  verdict: CheckoutFreshnessVerdict.BehindBase,
  reason: "HEAD is 4 commits behind origin/master (abc1234)",
  checkoutRoot: CWD,
  mainWorktreeRoot: "/work/repo",
  branch: "users/me/change",
  headSha: "1111111111111111111111111111111111111111",
  baseRef: "refs/remotes/origin/master",
  baseSha: "abc1234abc1234abc1234abc1234abc1234abc12",
  behindBy: 4,
  creationSha: null,
  inheritedCommitCount: 0,
  inheritedCommits: [],
  hasFetchFailed: false,
};

const FOREIGN_REPORT: ICheckoutFreshnessReport = {
  ...BEHIND_REPORT,
  verdict: CheckoutFreshnessVerdict.ForeignBase,
  reason: "users/me/change was created from users/peer/other at 2222222, which origin/master does not contain",
  inheritedCommitCount: 1,
  inheritedCommits: ["2222222 peer's unmerged work"],
};

const GENERATION_INPUT = {
  testCase: {
    id: TEST_CASE_ID,
    projectId: PROJECT_ID,
    useCaseId: USE_CASE_ID,
    title: "Sign in",
    goal: "Dashboard loads",
    expectedResult: "Dashboard",
    url: "https://app.example.com",
  },
  localUrl: "http://localhost:3999",
  cwd: CWD,
};

describe("isLoopbackUrl", () => {
  it.each([
    "http://localhost:3999",
    "http://127.0.0.1:5050/api",
    "http://127.4.5.6",
    "http://[::1]:8080",
    "http://0.0.0.0:3000",
    "http://app.localhost:3000",
  ])("treats %s as this machine", (url) => {
    expect(isLoopbackUrl(url)).toBe(true);
  });

  it.each(["https://staging.muggle-ai.com", "http://192.168.1.4:3000", "not a url"])("leaves %s alone", (url) => {
    expect(isLoopbackUrl(url)).toBe(false);
  });
});

describe("findRunCheckoutRefusal", () => {
  it("never consults git for a target off this machine", async () => {
    const runGit = vi.fn();
    expect(await findRunCheckoutRefusal({ cwd: CWD, localUrl: "https://staging.muggle-ai.com", runGit: runGit })).toBeNull();
    expect(runGit).not.toHaveBeenCalled();
  });

  it("lets a run proceed when the cwd is not a git checkout", async () => {
    const runGit = vi.fn(async () => null);
    expect(await findRunCheckoutRefusal({ cwd: CWD, localUrl: "http://localhost:3999", runGit: runGit })).toBeNull();
  });

  it("never fetches — the check reads local refs only", async () => {
    const runGit = vi.fn(async () => null);
    await findRunCheckoutRefusal({ cwd: CWD, localUrl: "http://localhost:3999", runGit: runGit });
    expect(runGit.mock.calls.some(([args]) => args[0] === "fetch")).toBe(false);
  });
});

describe("formatRunCheckoutRefusal", () => {
  it("names the verdict, the checkout, and the command that re-checks it", () => {
    const text = formatRunCheckoutRefusal(BEHIND_REPORT, CWD);
    expect(text).toContain("Run refused — checkout is not on the latest origin/master");
    expect(text).toContain("**Verdict:** BEHIND_BASE");
    expect(text).toContain(`muggle checkout-freshness --cwd "${CWD}"`);
    expect(text).toContain("Rebase this checkout onto `origin/master`");
  });

  it("lists inherited commits and the stacking escape for a foreign base", () => {
    const text = formatRunCheckoutRefusal(FOREIGN_REPORT, CWD);
    expect(text).toContain("- 2222222 peer's unmerged work");
    expect(text).toContain("pass it as `baseBranch`");
  });
});

describe("execute tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuse a stale checkout before anything launches", async () => {
    mockFindRunCheckoutRefusal.mockResolvedValue(BEHIND_REPORT);
    const result = await getTool("muggle-local-execute-test-generation")!.execute({
      input: GENERATION_INPUT,
      correlationId: "c1",
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Run refused");
    expect(mockExecuteTestGeneration).not.toHaveBeenCalled();
  });

  it("pass the caller's cwd, target and base to the gate", async () => {
    mockFindRunCheckoutRefusal.mockResolvedValue(BEHIND_REPORT);
    await getTool("muggle-local-execute-replay")!.execute({
      input: {
        testScript: {
          id: TEST_SCRIPT_ID,
          name: "Sign in",
          testCaseId: TEST_CASE_ID,
          actionScriptId: ACTION_SCRIPT_ID,
          projectId: PROJECT_ID,
          useCaseId: USE_CASE_ID,
        },
        actionScript: [],
        localUrl: "http://localhost:3999",
        cwd: CWD,
        baseBranch: "users/me/parent",
      },
      correlationId: "c2",
    });
    expect(mockFindRunCheckoutRefusal).toHaveBeenCalledWith({
      cwd: CWD,
      localUrl: "http://localhost:3999",
      baseBranch: "users/me/parent",
    });
    expect(mockExecuteReplay).not.toHaveBeenCalled();
  });

  it("run as before when the gate clears the checkout", async () => {
    mockFindRunCheckoutRefusal.mockResolvedValue(null);
    mockExecuteTestGeneration.mockResolvedValue({ id: "run-1", testScriptId: "ts-1", status: "passed", executionTimeMs: 10 });
    const result = await getTool("muggle-local-execute-test-generation")!.execute({
      input: GENERATION_INPUT,
      correlationId: "c3",
    });
    expect(result.isError).toBe(false);
    expect(mockExecuteTestGeneration).toHaveBeenCalledOnce();
  });
});
