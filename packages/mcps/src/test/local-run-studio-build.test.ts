/**
 * A local run's record names the studio build it spawned, read from that binary's own release
 * manifest: it is what proves which studio commit ran when the run is cited as a baseline.
 */
import { EventEmitter } from "node:events";
import * as fs from "fs/promises";
import * as os from "node:os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STUDIO_COMMIT_SHA = "cda91cd17932375d4a2590e38da05d8f4677b56d";

const harness = vi.hoisted(() => ({
  dataDir: "",
  electronAppPath: null as string | null,
  spawnedCommands: [] as string[],
  spawnedChildren: [] as unknown[],
}));

const createRunResult = vi.hoisted(() => vi.fn((_params: Record<string, unknown>) => ({ id: "44444444-4444-4444-8444-444444444444" })));
const updateRunResult = vi.hoisted(() => vi.fn((_runId: string, _update: Record<string, unknown>) => undefined));

vi.mock("../shared/config.js", () => ({
  getConfig: () => ({ logLevel: "silent", localQa: { dataDir: harness.dataDir } }),
  getElectronAppDir: () => "/fake/electron",
  getElectronAppVersion: () => "0.0.0",
  resolveElectronAppPathOrNull: () => harness.electronAppPath,
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

vi.mock("../mcp/local/services/index.js", () => ({
  getAuthService: () => ({
    getAuthStatus: () => ({ authenticated: true, userId: "user-1" }),
    loadStoredAuth: () => ({ accessToken: "token", email: "user@example.com", userId: "user-1" }),
  }),
  getRunResultStorageService: () => ({
    createRunResult: createRunResult,
    createTestScript: () => ({ id: "local-ts-1" }),
    updateRunResult: updateRunResult,
    updateTestScript: vi.fn(),
  }),
  getStorageService: () => ({ getSessionsDir: () => path.join(harness.dataDir, "sessions") }),
}));

class FakeStudioProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn(() => true);

  exit(code: number): void {
    this.emit("close", code, null);
  }
}

vi.mock("child_process", () => ({
  spawn: (command: string) => {
    const child = new FakeStudioProcess();
    harness.spawnedCommands.push(command);
    harness.spawnedChildren.push(child);
    return child;
  },
}));

import { executeReplay, executeTestGeneration } from "../mcp/local/services/execution-service.js";

const failedStudioRunAsync = async (runPromise: Promise<unknown>): Promise<void> => {
  await vi.waitFor(() => expect(harness.spawnedChildren).toHaveLength(1));
  (harness.spawnedChildren[0] as FakeStudioProcess).exit(1);
  await runPromise;
};

const startGeneration = () =>
  executeTestGeneration({
    testCase: {
      id: "tc-1",
      projectId: "proj-1",
      useCaseId: "uc-1",
      title: "Register a new account",
      goal: "Account is created",
      expectedResult: "Welcome page",
      url: "https://app.example.com",
    } as never,
    localUrl: "http://localhost:3000",
    cwd: "/repo",
    timeoutMs: 60_000,
  });

const startReplay = () =>
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
    timeoutMs: 60_000,
  });

const contextOf = (runWrite: Record<string, unknown>): Record<string, unknown> =>
  runWrite.localExecutionContext as Record<string, unknown>;

const lastRunUpdate = (): Record<string, unknown> => updateRunResult.mock.calls[updateRunResult.mock.calls.length - 1][1];

beforeEach(async () => {
  harness.dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "muggle-run-studio-build-"));
  await fs.mkdir(path.join(harness.dataDir, "pkg"), { recursive: true });
  await fs.writeFile(
    path.join(harness.dataDir, "pkg", "package.json"),
    JSON.stringify({ name: "@muggleai/works", version: "0.0.0", muggleConfig: { electronAppVersion: "0.0.0" } }),
  );
  const studioDir = path.join(harness.dataDir, "studio");
  const resourcesDir = path.join(studioDir, os.platform() === "darwin" ? path.join("..", "Resources") : "resources");
  await fs.mkdir(resourcesDir, { recursive: true });
  await fs.writeFile(
    path.join(resourcesDir, "release-manifest.json"),
    JSON.stringify({
      release: "20261103234154",
      buildId: "20261103234154",
      commitSha: STUDIO_COMMIT_SHA,
      buildTime: "2026-11-03T23:41:54Z",
      serviceName: "muggle-ai-teaching-studio",
    }),
  );
  harness.electronAppPath = path.join(studioDir, "MuggleAI.exe");
  harness.spawnedCommands = [];
  harness.spawnedChildren = [];
  createRunResult.mockClear();
  updateRunResult.mockClear();
});

afterEach(async () => {
  await fs.rm(harness.dataDir, { recursive: true, force: true });
});

describe("a local run's studio build", () => {
  it.each([
    ["generation", startGeneration],
    ["replay", startReplay],
  ])("stamps a failed %s with the build of the binary it spawned", async (_runType, startRun) => {
    await failedStudioRunAsync(startRun());

    const expectedBuild = {
      commitSha: STUDIO_COMMIT_SHA,
      buildId: "20261103234154",
      buildTime: "2026-11-03T23:41:54Z",
      executablePath: harness.electronAppPath,
    };
    expect(harness.spawnedCommands).toEqual([harness.electronAppPath]);
    expect(contextOf(createRunResult.mock.calls[0][0]).studioBuild).toEqual(expectedBuild);
    expect(contextOf(lastRunUpdate()).studioBuild).toEqual(expectedBuild);
    expect(lastRunUpdate().status).toBe("failed");
  });

  it("runs unstamped from a binary with no manifest", async () => {
    harness.electronAppPath = path.join(harness.dataDir, "elsewhere", "nested", "MuggleAI.exe");

    await failedStudioRunAsync(startReplay());

    expect(contextOf(lastRunUpdate())).not.toHaveProperty("studioBuild");
  });

  it("still fails the run with the install guidance when no binary resolves", async () => {
    harness.electronAppPath = null;

    const run = await startReplay();

    expect(run.status).toBe("failed");
    expect(run.errorMessage).toContain("Electron app binary not found.");
    expect(harness.spawnedCommands).toEqual([]);
    expect(contextOf(createRunResult.mock.calls[0][0])).not.toHaveProperty("studioBuild");
  });
});
