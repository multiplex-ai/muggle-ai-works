import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeQaTool, executeWebsiteScan, sharedLogger } = vi.hoisted(() => ({
  executeQaTool: vi.fn(),
  executeWebsiteScan: vi.fn(),
  sharedLogger: { level: "info" },
}));

vi.mock("../../../packages/mcps/src/index.js", () => ({
  e2e: {
    executeQaTool: executeQaTool,
    USE_CASE_DISCOVERY_MEMORY_GET_TOOL_NAME: "muggle-remote-use-case-discovery-memory-get",
  },
  localQa: {
    executeWebsiteScan: executeWebsiteScan,
    DEFAULT_WEBSITE_SCAN_TIMEOUT_MS: 1_800_000,
    WebsiteScanExitEnum: { Completed: "completed", TimedOut: "timed_out", Failed: "failed" },
    StudioJobPriorityEnum: { Paid: "paid", Free: "free", Internal: "internal", Promotion: "promotion" },
    getStorageService: () => ({ getSessionsDir: () => "/sessions" }),
  },
  getLogger: () => sharedLogger,
}));

import { localScanCommand, runLocalScanAsync } from "../../cli/local/local-scan.js";
import { SCAN_REQUIRES_LOCAL_FLAG_MESSAGE } from "../../cli/local/local-scan-constants.js";
import { LocalScanStatusEnum } from "../../cli/local/local-scan-types.js";
import { isSignedInFlow, parseLocalScanLimits } from "../../cli/local/website-scan-candidates.js";

const SITE_URL = "https://example.com";

function makeCandidate(params: { id: string; createdAt: number; title: string; status?: string; url?: string }) {
  return {
    id: params.id,
    status: params.status ?? "candidate",
    createdAt: params.createdAt,
    useCase: { title: params.title, description: `${params.title} works`, url: params.url },
  };
}

function memoryResult(memory: unknown) {
  return { isError: false, content: JSON.stringify({ memory: memory }) };
}

describe("runLocalScanAsync", () => {
  beforeEach(() => {
    executeQaTool.mockReset();
    executeWebsiteScan.mockReset();
  });

  it("reports only the candidates the scan added, oldest first, without dropped ones", async () => {
    const existing = makeCandidate({ id: "old", createdAt: 1, title: "Old flow" });
    executeQaTool.mockResolvedValueOnce(memoryResult({ id: "memory-1", useCaseCandidates: [existing] }));
    executeQaTool.mockResolvedValueOnce(
      memoryResult({
        id: "memory-1",
        useCaseCandidates: [
          existing,
          makeCandidate({ id: "b", createdAt: 30, title: "Log in and view orders", url: `${SITE_URL}/orders` }),
          makeCandidate({ id: "a", createdAt: 20, title: "Search the catalog" }),
          makeCandidate({ id: "c", createdAt: 40, title: "Rejected", status: "dropped" }),
        ],
      }),
    );
    executeWebsiteScan.mockResolvedValue({ runId: "run-1", exit: "completed", durationMs: 5, failureMessage: null });

    const report = await runLocalScanAsync({ projectId: "p-1", url: SITE_URL, maxCandidates: "10" });

    expect(executeWebsiteScan).toHaveBeenCalledWith(
      expect.objectContaining({ useCaseDiscoverMemoryId: "memory-1", targetUseCaseCandidateCount: 11 }),
    );
    expect(report.status).toBe(LocalScanStatusEnum.Finished);
    expect(report.error).toBeNull();
    expect(report.candidates).toEqual([
      { title: "Search the catalog", description: "Search the catalog works", startUrl: SITE_URL, requiresSignIn: false },
      { title: "Log in and view orders", description: "Log in and view orders works", startUrl: `${SITE_URL}/orders`, requiresSignIn: true },
    ]);
  });

  it("caps at --max-candidates and keeps the first ones found", async () => {
    executeQaTool.mockResolvedValueOnce(memoryResult(null));
    executeQaTool.mockResolvedValueOnce(
      memoryResult({
        id: "fresh",
        useCaseCandidates: [1, 2, 3].map((index) => makeCandidate({ id: `c${index}`, createdAt: index, title: `Flow ${index}` })),
      }),
    );
    executeWebsiteScan.mockResolvedValue({ runId: "run-2", exit: "completed", durationMs: 5, failureMessage: null });

    const report = await runLocalScanAsync({ projectId: "p-1", url: SITE_URL, maxCandidates: "2" });

    expect(executeWebsiteScan).toHaveBeenCalledWith(expect.objectContaining({ targetUseCaseCandidateCount: 2 }));
    expect(report.status).toBe(LocalScanStatusEnum.Capped);
    expect(report.candidates.map((candidate) => candidate.title)).toEqual(["Flow 1", "Flow 2"]);
  });

  it("reports a timed-out scan as capped with what it found", async () => {
    executeQaTool.mockResolvedValueOnce(memoryResult(null));
    executeQaTool.mockResolvedValueOnce(memoryResult({ id: "m", useCaseCandidates: [makeCandidate({ id: "x", createdAt: 1, title: "Flow" })] }));
    executeWebsiteScan.mockResolvedValue({ runId: "run-3", exit: "timed_out", durationMs: 5, failureMessage: null });

    const report = await runLocalScanAsync({ projectId: "p-1", url: SITE_URL });

    expect(report.status).toBe(LocalScanStatusEnum.Capped);
    expect(report.candidates).toHaveLength(1);
  });

  it("reports a Studio failure as an error naming the first line and the logs", async () => {
    executeQaTool.mockResolvedValue(memoryResult(null));
    executeWebsiteScan.mockResolvedValue({
      runId: "run-4",
      exit: "failed",
      durationMs: 5,
      failureMessage: "Electron exited with code 1.\nSTDOUT:\nnoise",
    });

    const report = await runLocalScanAsync({ projectId: "p-1", url: SITE_URL });

    expect(report.status).toBe(LocalScanStatusEnum.Error);
    expect(report.error).toMatch(/^Electron exited with code 1\. Studio logs: .*run-4$/);
  });

  it("reports an unreadable memory as an error without starting Studio", async () => {
    executeQaTool.mockResolvedValue({ isError: true, content: JSON.stringify({ message: "Not authenticated" }) });

    const report = await runLocalScanAsync({ projectId: "p-1", url: SITE_URL });

    expect(executeWebsiteScan).not.toHaveBeenCalled();
    expect(report).toMatchObject({ status: LocalScanStatusEnum.Error, candidates: [] });
    expect(report.error).toContain("Not authenticated");
  });

  it("queues the scan in the class --priority names", async () => {
    executeQaTool.mockResolvedValue(memoryResult(null));
    executeWebsiteScan.mockResolvedValue({ runId: "run-5", exit: "completed", durationMs: 5, failureMessage: null });

    await runLocalScanAsync({ projectId: "p-1", url: SITE_URL, priority: "promotion" });

    expect(executeWebsiteScan).toHaveBeenCalledWith(expect.objectContaining({ priority: "promotion" }));
  });

  it("reports an unknown --priority as an error without starting Studio", async () => {
    executeQaTool.mockResolvedValue(memoryResult(null));

    const report = await runLocalScanAsync({ projectId: "p-1", url: SITE_URL, priority: "urgent" });

    expect(executeWebsiteScan).not.toHaveBeenCalled();
    expect(report.status).toBe(LocalScanStatusEnum.Error);
    expect(report.error).toContain("--priority must be one of paid, free, internal, promotion");
  });
});

describe("localScanCommand", () => {
  beforeEach(() => {
    executeQaTool.mockReset();
    executeWebsiteScan.mockReset();
    process.exitCode = undefined;
  });

  it("refuses to scan without --local and exits 1", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await localScanCommand({ projectId: "p-1", url: SITE_URL, json: true });

    expect(errorSpy).toHaveBeenCalledWith(SCAN_REQUIRES_LOCAL_FLAG_MESSAGE);
    expect(process.exitCode).toBe(1);
    expect(executeQaTool).not.toHaveBeenCalled();
    expect(executeWebsiteScan).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  it("scans and prints one JSON line with --local", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    executeQaTool.mockResolvedValue(memoryResult(null));
    executeWebsiteScan.mockResolvedValue({ exit: "completed", useCaseDiscoverMemoryId: "memory-1" });

    await localScanCommand({ projectId: "p-1", url: SITE_URL, local: true, json: true });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toHaveProperty("status");
    expect(process.exitCode).toBeUndefined();
    logSpy.mockRestore();
  });
});

describe("parseLocalScanLimits", () => {
  it("defaults to 30 candidates and the given timeout", () => {
    expect(parseLocalScanLimits({ maxCandidatesOption: undefined, timeoutMsOption: undefined, defaultTimeoutMs: 99 })).toEqual({
      maxCandidates: 30,
      timeoutMs: 99,
    });
  });

  it("rejects a non-positive or fractional value", () => {
    expect(() => parseLocalScanLimits({ maxCandidatesOption: "0", timeoutMsOption: undefined, defaultTimeoutMs: 1 })).toThrow(
      "--max-candidates",
    );
    expect(() => parseLocalScanLimits({ maxCandidatesOption: undefined, timeoutMsOption: "1.5", defaultTimeoutMs: 1 })).toThrow(
      "--timeout-ms",
    );
  });
});

describe("isSignedInFlow", () => {
  it("flags sign-in wording and leaves sign-up alone", () => {
    expect(isSignedInFlow({ title: "Update profile", description: "Signed-in user edits their name" })).toBe(true);
    expect(isSignedInFlow({ title: "Checkout", useCaseBreakdown: [{ requirement: "User logs in first" }] })).toBe(true);
    expect(isSignedInFlow({ title: "Sign up for the newsletter", description: "Visitor subscribes" })).toBe(false);
  });
});
