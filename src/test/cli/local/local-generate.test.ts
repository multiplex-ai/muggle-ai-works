import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { executeQaTool, executeTool, getRunResult, listActiveExecutions, cancelExecution } = vi.hoisted(() => ({
  executeQaTool: vi.fn(),
  executeTool: vi.fn(),
  getRunResult: vi.fn(),
  listActiveExecutions: vi.fn(),
  cancelExecution: vi.fn(),
}));

vi.mock("../../../../packages/mcps/src/index.js", async (importOriginal) => {
  const actualMcps = await importOriginal<typeof import("../../../../packages/mcps/src/index.js")>();
  return {
    ...actualMcps,
    getActiveRuntimeTarget: () => "production",
    e2e: { ...actualMcps.e2e, executeQaTool: executeQaTool },
    localQa: {
      ...actualMcps.localQa,
      executeTool: executeTool,
      getRunResultStorageService: () => ({ getRunResult: getRunResult }),
      listActiveExecutions: listActiveExecutions,
      cancelExecution: cancelExecution,
    },
  };
});

import { generateCommand, runLocalGenerateAsync } from "../../../cli/local/local-generate.js";
import { LOCAL_FLAG_REQUIRED_MESSAGE } from "../../../cli/local/local-generate-constants.js";
import { LocalGenerateStatus, type ILocalGenerateArgs } from "../../../cli/local/local-generate-types.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TEST_CASE_ID = "22222222-2222-4222-8222-222222222222";

const remoteTestCase = {
  id: TEST_CASE_ID,
  title: "Sign up",
  description: "Sign up. Do not pay.",
  goal: "Account created",
  expectedResult: "Dashboard shows",
  url: "https://example.com/",
  projectId: PROJECT_ID,
  useCaseId: "33333333-3333-4333-8333-333333333333",
};

const generateArgs: ILocalGenerateArgs = {
  projectId: PROJECT_ID,
  testCaseId: TEST_CASE_ID,
  isLightMode: true,
  isUiShown: false,
  timeoutMs: 600000,
  isJsonOutput: true,
};

function remoteToolAnswers(answersByToolName: Record<string, { content: unknown; isError?: boolean }>): void {
  executeQaTool.mockImplementation(async (toolName: string) => {
    const answer = answersByToolName[toolName];
    if (!answer) {
      return { content: JSON.stringify({ message: `unexpected ${toolName}` }), isError: true };
    }
    return { content: JSON.stringify(answer.content), isError: answer.isError ?? false };
  });
}

beforeEach(() => {
  listActiveExecutions.mockReturnValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
});

describe("runLocalGenerateAsync", () => {
  it("runs the MCP generation tool with the fetched test case and reports the published ids", async () => {
    remoteToolAnswers({
      "muggle-remote-test-case-get": { content: remoteTestCase },
      "muggle-remote-wf-get-latest-ts-gen-by-tc": { content: { id: "runtime-1" } },
      "muggle-remote-wf-get-ts-gen-latest-run": {
        content: { id: "cloud-run-1", createdAt: Date.now() + 1000, taskDef: { testCaseId: TEST_CASE_ID } },
      },
    });
    executeTool.mockResolvedValue({ content: "ok", isError: false, data: { id: "local-run-1", status: "passed" } });
    getRunResult.mockReturnValue({ status: "passed", cloudActionScriptId: "as-1" });

    const generationOutcome = await runLocalGenerateAsync({ args: generateArgs, commandStartedAt: Date.now() });

    expect(executeTool).toHaveBeenCalledWith(
      "muggle-local-execute-test-generation",
      {
        testCase: remoteTestCase,
        localUrl: "https://example.com/",
        cwd: process.cwd(),
        showUi: false,
        lightMode: true,
        timeoutMs: 600000,
      },
      expect.any(String),
    );
    expect(generationOutcome).toEqual({
      status: LocalGenerateStatus.Passed,
      runId: "local-run-1",
      testCaseId: TEST_CASE_ID,
      actionScriptId: "as-1",
      uploadedRunId: "cloud-run-1",
      durationMs: expect.any(Number),
      error: null,
    });
  });

  it("generates for a DRAFT test case without changing its status or calling any write tool", async () => {
    remoteToolAnswers({
      "muggle-remote-test-case-get": { content: { ...remoteTestCase, status: "DRAFT" } },
      "muggle-remote-wf-get-latest-ts-gen-by-tc": { content: { id: "runtime-1" } },
      "muggle-remote-wf-get-ts-gen-latest-run": {
        content: { id: "cloud-run-1", createdAt: Date.now() + 1000, taskDef: { testCaseId: TEST_CASE_ID } },
      },
    });
    executeTool.mockResolvedValue({ content: "ok", isError: false, data: { id: "local-run-5", status: "passed" } });
    getRunResult.mockReturnValue({ status: "passed", cloudActionScriptId: "as-5" });

    const generationOutcome = await runLocalGenerateAsync({ args: generateArgs, commandStartedAt: Date.now() });

    expect(generationOutcome.status).toBe(LocalGenerateStatus.Passed);
    expect(executeTool.mock.calls[0]![1]).not.toHaveProperty("testCase.status");
    expect(executeQaTool.mock.calls.map((call) => call[0])).toEqual([
      "muggle-remote-test-case-get",
      "muggle-remote-wf-get-latest-ts-gen-by-tc",
      "muggle-remote-wf-get-ts-gen-latest-run",
    ]);
  });

  it("reports no cloud run when the latest one predates this run", async () => {
    remoteToolAnswers({
      "muggle-remote-test-case-get": { content: remoteTestCase },
      "muggle-remote-wf-get-latest-ts-gen-by-tc": { content: { id: "runtime-1" } },
      "muggle-remote-wf-get-ts-gen-latest-run": {
        content: { id: "old-run", createdAt: Date.now() - 3_600_000, taskDef: { testCaseId: TEST_CASE_ID } },
      },
    });
    executeTool.mockResolvedValue({ content: "ok", isError: false, data: { id: "local-run-1", status: "passed" } });
    getRunResult.mockReturnValue({ status: "passed", cloudActionScriptId: "as-1" });

    const generationOutcome = await runLocalGenerateAsync({ args: generateArgs, commandStartedAt: Date.now() });

    expect(generationOutcome.actionScriptId).toBe("as-1");
    expect(generationOutcome.uploadedRunId).toBeNull();
  });

  it("reports a failed run with its error headline and skips the lookup when nothing was published", async () => {
    remoteToolAnswers({ "muggle-remote-test-case-get": { content: remoteTestCase } });
    executeTool.mockResolvedValue({
      content: "## Test Generation Failed",
      isError: true,
      data: { id: "local-run-2", status: "failed", errorMessage: "Electron exited with code 1.\nSTDOUT:\nnoise" },
    });
    getRunResult.mockReturnValue({ status: "failed", errorMessage: "Electron exited with code 1.\nSTDOUT:\nnoise" });

    const generationOutcome = await runLocalGenerateAsync({ args: generateArgs, commandStartedAt: Date.now() });

    expect(generationOutcome).toMatchObject({
      status: LocalGenerateStatus.Failed,
      runId: "local-run-2",
      actionScriptId: null,
      uploadedRunId: null,
      error: "Electron exited with code 1.",
    });
    expect(executeQaTool).toHaveBeenCalledTimes(1);
  });

  it("reports a cancelled run as cancelled", async () => {
    remoteToolAnswers({ "muggle-remote-test-case-get": { content: remoteTestCase } });
    executeTool.mockResolvedValue({ content: "", isError: true, data: { id: "local-run-3", status: "failed" } });
    getRunResult.mockReturnValue({ status: "cancelled", errorMessage: "Run stopped: cancelled." });

    const generationOutcome = await runLocalGenerateAsync({ args: generateArgs, commandStartedAt: Date.now() });

    expect(generationOutcome.status).toBe(LocalGenerateStatus.Cancelled);
  });

  it("cancels the in-flight run on SIGINT so the studio can publish it", async () => {
    remoteToolAnswers({ "muggle-remote-test-case-get": { content: remoteTestCase } });
    listActiveExecutions.mockReturnValue([{ runId: "local-run-4", status: "running" }]);
    executeTool.mockImplementation(async () => {
      process.emit("SIGINT", "SIGINT");
      return { content: "", isError: true, data: { id: "local-run-4", status: "failed" } };
    });
    getRunResult.mockReturnValue({ status: "cancelled" });

    await runLocalGenerateAsync({ args: generateArgs, commandStartedAt: Date.now() });

    expect(cancelExecution).toHaveBeenCalledWith({ runId: "local-run-4" });
    expect(process.listenerCount("SIGINT")).toBe(0);
  });

  it("reports an error with no run id when the test case cannot be fetched", async () => {
    remoteToolAnswers({
      "muggle-remote-test-case-get": { content: { message: "Missing authentication." }, isError: true },
    });

    const generationOutcome = await runLocalGenerateAsync({ args: generateArgs, commandStartedAt: Date.now() });

    expect(generationOutcome).toMatchObject({
      status: LocalGenerateStatus.Error,
      runId: null,
      error: "muggle-remote-test-case-get failed: Missing authentication.",
    });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("reports an error with no run id when the tool refuses before starting a run", async () => {
    remoteToolAnswers({ "muggle-remote-test-case-get": { content: remoteTestCase } });
    executeTool.mockResolvedValue({ content: "Test generation failed: Not authenticated.", isError: true });

    const generationOutcome = await runLocalGenerateAsync({ args: generateArgs, commandStartedAt: Date.now() });

    expect(generationOutcome).toMatchObject({
      status: LocalGenerateStatus.Error,
      runId: null,
      error: "Test generation failed: Not authenticated.",
    });
  });
});

describe("generateCommand", () => {
  it("prints exactly one JSON line and exits 0 even when the run failed", async () => {
    remoteToolAnswers({
      "muggle-remote-test-case-get": { content: { message: "not found" }, isError: true },
    });
    const writtenChunks: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writtenChunks.push(String(chunk));
      return true;
    });

    await generateCommand({ local: true, projectId: PROJECT_ID, testCaseId: TEST_CASE_ID, json: true });
    stdoutWrite.mockRestore();

    expect(writtenChunks).toHaveLength(1);
    expect(writtenChunks[0]!.endsWith("\n")).toBe(true);
    expect(Object.keys(JSON.parse(writtenChunks[0]!))).toEqual([
      "status",
      "runId",
      "testCaseId",
      "actionScriptId",
      "uploadedRunId",
      "durationMs",
      "error",
    ]);
    expect(process.exitCode).toBe(0);
  });

  it("refuses without --local, before any backend call, with a one-line message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdoutWrite = vi.spyOn(process.stdout, "write");

    await generateCommand({ projectId: PROJECT_ID, testCaseId: TEST_CASE_ID, json: true });

    expect(process.exitCode).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(LOCAL_FLAG_REQUIRED_MESSAGE);
    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(executeQaTool).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
    consoleError.mockRestore();
    stdoutWrite.mockRestore();
  });

  it("exits non-zero without printing JSON when the arguments are invalid", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdoutWrite = vi.spyOn(process.stdout, "write");

    await generateCommand({ local: true, projectId: PROJECT_ID, testCaseId: TEST_CASE_ID, timeoutMs: "-5", json: true });

    expect(process.exitCode).toBe(1);
    expect(stdoutWrite).not.toHaveBeenCalled();
    consoleError.mockRestore();
    stdoutWrite.mockRestore();
  });
});
