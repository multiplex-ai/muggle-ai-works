/**
 * A local run the MCP stops — time limit or cancel — is asked to stop instead of being killed, so the studio can
 * publish what it recorded, and the run still goes through the normal post-run path: logs, preserved screenshots,
 * cloud refs, and a failed/cancelled verdict whatever the exit code.
 */
import { EventEmitter } from "node:events";
import * as fs from "fs/promises";
import * as os from "node:os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RUN_ID = "22222222-2222-4222-8222-222222222222";

const harness = vi.hoisted(() => ({ dataDir: "", spawnedChildren: [] as unknown[] }));

vi.mock("../shared/config.js", () => ({
  getConfig: () => ({ logLevel: "silent", localQa: { dataDir: harness.dataDir } }),
  getElectronAppDir: () => "/fake/electron",
  getElectronAppVersion: () => "0.0.0",
  resolveElectronAppPathOrNull: () => "/fake/electron/MuggleAI.exe",
}));

vi.mock("../shared/logger.js", () => {
  const noop = () => undefined;
  const fakeLogger = { info: noop, warn: noop, error: noop, debug: noop, child: () => fakeLogger };
  return { getLogger: () => fakeLogger, createChildLogger: () => fakeLogger, resetLogger: noop };
});

// The service reads its own package.json for version metadata; point it at a stub in the test's data dir.
vi.mock("node:url", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:url")>();
  return {
    ...actual,
    fileURLToPath: (url: string | URL) =>
      String(url).includes("execution-service")
        ? path.join(harness.dataDir, "pkg", "dist", "mcp", "execution-service.js")
        : actual.fileURLToPath(url),
  };
});

vi.mock("../shared/llm-env-service.js", () => ({
  applyLlmEnvOverrides: (env: NodeJS.ProcessEnv) => ({ env: env, appliedNames: [] }),
}));

vi.mock("../mcp/local/services/local-execution-lock.js", () => ({
  acquireLocalExecutionLock: async () => ({ release: async () => undefined }),
}));

const updateRunResult = vi.fn();

vi.mock("../mcp/local/services/index.js", () => ({
  getAuthService: () => ({
    getAuthStatus: () => ({ authenticated: true, userId: "user-1" }),
    loadStoredAuth: () => ({ accessToken: "token", email: "user@example.com", userId: "user-1" }),
  }),
  getRunResultStorageService: () => ({
    createRunResult: () => ({ id: RUN_ID }),
    updateRunResult: updateRunResult,
    updateTestScript: vi.fn(),
  }),
  getStorageService: () => ({ getSessionsDir: () => path.join(harness.dataDir, "sessions") }),
}));

class FakeStudioProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn((signal?: NodeJS.Signals) => {
    this.exit(null, signal ?? "SIGTERM");
    return true;
  });

  exit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("close", code, signal);
  }
}

vi.mock("child_process", () => ({
  spawn: () => {
    const child = new FakeStudioProcess();
    harness.spawnedChildren.push(child);
    return child;
  },
}));

import { cancelExecution, executeReplay } from "../mcp/local/services/execution-service.js";
import { STOP_REQUEST_GRACE_MS } from "../mcp/local/services/execution-stop-constants.js";

const TIMEOUT_MS = 1_000;

const _stopRequestPath = (): string => path.join(harness.dataDir, "temp", `${RUN_ID}_stop_requested`);

const _startReplay = () =>
  executeReplay({
    testScript: {
      id: "ts-1",
      name: "Checkout",
      testCaseId: "tc-1",
      projectId: "proj-1",
      useCaseId: "uc-1",
      url: "https://app.example.com",
      actionScriptId: "as-1",
    } as never,
    actionScript: [],
    localUrl: "http://localhost:3000",
    cwd: "/repo",
    timeoutMs: TIMEOUT_MS,
  });

const _spawnedStudio = async (): Promise<FakeStudioProcess> => {
  await vi.waitFor(() => expect(harness.spawnedChildren).toHaveLength(1));
  return harness.spawnedChildren[0] as FakeStudioProcess;
};

const _finalRunResultUpdate = (): Record<string, unknown> =>
  updateRunResult.mock.calls[updateRunResult.mock.calls.length - 1][1];

beforeEach(async () => {
  harness.dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "muggle-graceful-stop-"));
  await fs.mkdir(path.join(harness.dataDir, "pkg"), { recursive: true });
  await fs.writeFile(
    path.join(harness.dataDir, "pkg", "package.json"),
    JSON.stringify({ name: "@muggleai/works", version: "0.0.0", muggleConfig: { electronAppVersion: "0.0.0" } }),
  );
  harness.spawnedChildren = [];
  updateRunResult.mockClear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(async () => {
  vi.useRealTimers();
  await fs.rm(harness.dataDir, { recursive: true, force: true });
});

describe("a run that outlives its time limit", () => {
  it("is asked to stop, not killed, and is recorded as failed with its cloud refs once the studio exits", async () => {
    const runPromise = _startReplay();
    const studio = await _spawnedStudio();

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await vi.waitFor(async () => expect(await fs.readFile(_stopRequestPath(), "utf-8")).toBe("timeout"));
    expect(studio.kill).not.toHaveBeenCalled();

    // The studio publishes, writes its cloud refs, and exits on its own.
    await fs.writeFile(
      path.join(harness.dataDir, "temp", `cloudrefs_${RUN_ID}_input.json`),
      JSON.stringify({ viewUrl: "https://www.muggle-ai.com/run/stopped" }),
    );
    studio.exit(0, null);

    const runResult = await runPromise;
    expect(runResult.status).toBe("failed");
    expect(runResult.errorMessage).toContain("exceeded its 1000ms time limit");
    expect(_finalRunResultUpdate()).toMatchObject({
      status: "failed",
      viewUrl: "https://www.muggle-ai.com/run/stopped",
    });
    await vi.waitFor(async () => expect(fs.access(_stopRequestPath())).rejects.toThrow());
  });

  it("is hard-killed after the grace period, and still goes through the post-run path", async () => {
    const runPromise = _startReplay();
    const studio = await _spawnedStudio();

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await vi.waitFor(async () => expect(fs.access(_stopRequestPath())).resolves.toBeUndefined());
    await vi.advanceTimersByTimeAsync(STOP_REQUEST_GRACE_MS);

    expect(studio.kill).toHaveBeenCalledWith("SIGTERM");
    const runResult = await runPromise;
    expect(runResult.status).toBe("failed");
    expect(_finalRunResultUpdate()).toMatchObject({
      status: "failed",
      artifactsDir: path.join(harness.dataDir, "sessions", RUN_ID),
    });
  });
});

describe("a cancelled run", () => {
  it("is asked to stop and recorded as cancelled, never passed, even when the studio exits cleanly", async () => {
    const runPromise = _startReplay();
    const studio = await _spawnedStudio();

    expect(cancelExecution({ runId: RUN_ID })).toBe(true);
    await vi.waitFor(async () => expect(await fs.readFile(_stopRequestPath(), "utf-8")).toBe("cancelled"));
    expect(studio.kill).not.toHaveBeenCalled();

    studio.exit(0, null);

    const runResult = await runPromise;
    expect(runResult.status).toBe("failed");
    expect(_finalRunResultUpdate()).toMatchObject({
      status: "cancelled",
      errorMessage: expect.stringContaining("Run cancelled by user."),
    });
  });
});

describe("a replay that fails on its own", () => {
  it("keeps the studio's cloud refs so the run's viewUrl is not lost", async () => {
    const runPromise = _startReplay();
    const studio = await _spawnedStudio();

    await fs.writeFile(
      path.join(harness.dataDir, "temp", `cloudrefs_${RUN_ID}_input.json`),
      JSON.stringify({ viewUrl: "https://www.muggle-ai.com/run/failed", actionScriptId: "cloud-as-9" }),
    );
    studio.exit(1, null);

    await runPromise;
    expect(_finalRunResultUpdate()).toMatchObject({
      status: "failed",
      viewUrl: "https://www.muggle-ai.com/run/failed",
      cloudActionScriptId: "cloud-as-9",
    });
  });
});
