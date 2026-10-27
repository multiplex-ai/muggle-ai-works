/** The local execute tools launch the Studio browser the way the showElectronBrowser preference says. */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { PreferenceKey, PreferenceValue } from "../shared/preferences-types.js";

vi.mock("../shared/config.js", () => ({
  getConfig: () => ({
    logLevel: "silent",
    serverName: "test",
    serverVersion: "0.0.0",
    e2e: {
      promptServiceBaseUrl: "http://test.invalid",
      requestTimeoutMs: 1000,
      workflowTimeoutMs: 1000,
    },
  }),
  getDashboardBaseUrl: () => "https://staging.muggle-ai.com/muggleTestV0/dashboard/projects",
}));

vi.mock("../shared/logger.js", () => {
  const noop = () => undefined;
  const fakeLogger = { info: noop, warn: noop, error: noop, debug: noop, verbose: noop, silly: noop, child: () => fakeLogger };
  return { getLogger: () => fakeLogger, createChildLogger: () => fakeLogger, resetLogger: noop };
});

const { mockExecuteTestGeneration, mockExecuteReplay, mockResolvePreferences } = vi.hoisted(() => ({
  mockExecuteTestGeneration: vi.fn(),
  mockExecuteReplay: vi.fn(),
  mockResolvePreferences: vi.fn(),
}));

vi.mock("../shared/preferences-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/preferences-service.js")>()),
  resolvePreferences: mockResolvePreferences,
}));

vi.mock("../mcp/local/services/index.js", () => ({
  cancelExecution: vi.fn(),
  executeReplay: mockExecuteReplay,
  executeTestGeneration: mockExecuteTestGeneration,
  findRunCheckoutRefusal: async () => null,
  getAuthService: () => ({ getAuthStatus: () => ({ authenticated: true }) }),
  getStorageService: () => ({ getDataDir: () => "/tmp", getSessionsDir: () => "/tmp" }),
  getRunResultStorageService: () => ({ getRunResult: vi.fn(), getTestScript: vi.fn() }),
}));

vi.mock("../mcp/local/services/run-stack-gate.js", () => ({
  findRunStackRefusal: async () => null,
  findStackChangedDuringRun: async () => null,
  runUnderStackLease: async (params: { execute: () => Promise<unknown> }) => await params.execute(),
}));

import { getTool } from "../mcp/tools/local/tool-registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const USE_CASE_ID = "22222222-2222-4222-8222-222222222222";
const TEST_CASE_ID = "33333333-3333-4333-8333-333333333333";
const PASSED_RUN = { id: "run-1", testScriptId: "ts-1", status: "passed", executionTimeMs: 10 };

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
  cwd: "/work/repo",
};

const REPLAY_INPUT = {
  testScript: {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Sign in",
    testCaseId: TEST_CASE_ID,
    actionScriptId: "55555555-5555-4555-8555-555555555555",
    projectId: PROJECT_ID,
    useCaseId: USE_CASE_ID,
  },
  actionScript: [],
  localUrl: "http://localhost:3999",
  cwd: "/work/repo",
};

const setShowElectronBrowserPreference = (preferenceValue: PreferenceValue): void => {
  mockResolvePreferences.mockReturnValue({ [PreferenceKey.ShowElectronBrowser]: preferenceValue });
};

describe("local execute tools and the showElectronBrowser preference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteTestGeneration.mockResolvedValue(PASSED_RUN);
    mockExecuteReplay.mockResolvedValue(PASSED_RUN);
  });

  it("shows the browser under always even when the caller asks for headless, and says so", async () => {
    setShowElectronBrowserPreference(PreferenceValue.Always);

    const result = await getTool("muggle-local-execute-test-generation")!.execute({
      input: { ...GENERATION_INPUT, showUi: false },
      correlationId: "c1",
    });

    expect(mockExecuteTestGeneration).toHaveBeenCalledWith(expect.objectContaining({ showUi: true }));
    expect(result.content).toContain('**UI:** visible GUI — showElectronBrowser is "always", so showUi: false was ignored');
  });

  it("runs a replay headless under never even when the caller asks to show it", async () => {
    setShowElectronBrowserPreference(PreferenceValue.Never);

    const result = await getTool("muggle-local-execute-replay")!.execute({
      input: { ...REPLAY_INPUT, showUi: true },
      correlationId: "c2",
    });

    expect(mockExecuteReplay).toHaveBeenCalledWith(expect.objectContaining({ showUi: false }));
    expect(result.content).toContain('**UI:** headless — showElectronBrowser is "never", so showUi: true was ignored');
  });

  it("honours the caller's showUi under ask", async () => {
    setShowElectronBrowserPreference(PreferenceValue.Ask);

    const result = await getTool("muggle-local-execute-replay")!.execute({
      input: { ...REPLAY_INPUT, showUi: false },
      correlationId: "c3",
    });

    expect(mockExecuteReplay).toHaveBeenCalledWith(expect.objectContaining({ showUi: false }));
    expect(result.content).toContain("**UI:** headless");
    expect(result.content).not.toContain("was ignored");
  });
});
