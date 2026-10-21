/**
 * A local generation resolves its fresh-session value once, so the session the studio is told to
 * clear and the value the recording carries for replay can never disagree: an explicit caller
 * value overrides the test case's stored flag in both places.
 */
import { EventEmitter } from "node:events";
import * as fs from "fs/promises";
import * as os from "node:os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RUN_ID = "33333333-3333-4333-8333-333333333333";

const harness = vi.hoisted(() => ({ dataDir: "", spawnedArgs: [] as string[][], spawnedChildren: [] as unknown[] }));

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

vi.mock("../mcp/local/services/index.js", () => ({
  getAuthService: () => ({
    getAuthStatus: () => ({ authenticated: true, userId: "user-1" }),
    loadStoredAuth: () => ({ accessToken: "token", email: "user@example.com", userId: "user-1" }),
  }),
  getRunResultStorageService: () => ({
    createRunResult: () => ({ id: RUN_ID }),
    createTestScript: () => ({ id: "local-ts-1" }),
    updateRunResult: vi.fn(),
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
  spawn: (_command: string, spawnArgs: string[]) => {
    const child = new FakeStudioProcess();
    harness.spawnedArgs.push(spawnArgs);
    harness.spawnedChildren.push(child);
    return child;
  },
}));

import { executeTestGeneration } from "../mcp/local/services/execution-service.js";

const runGenerationAsync = async ({
  requestedFreshSession,
  storedAlwaysStartsFreshSession,
}: {
  requestedFreshSession?: boolean;
  storedAlwaysStartsFreshSession?: boolean;
}): Promise<{ hasFreshSessionFlag: boolean; recordedActionParams: Record<string, unknown> }> => {
  const runPromise = executeTestGeneration({
    testCase: {
      id: "tc-1",
      projectId: "proj-1",
      useCaseId: "uc-1",
      title: "Register a new account",
      goal: "Account is created",
      expectedResult: "Welcome page",
      url: "https://app.example.com",
      ...(storedAlwaysStartsFreshSession !== undefined && {
        alwaysStartsFreshSession: storedAlwaysStartsFreshSession,
      }),
    } as never,
    localUrl: "http://localhost:3000",
    cwd: "/repo",
    timeoutMs: 60_000,
    ...(requestedFreshSession !== undefined && { freshSession: requestedFreshSession }),
  });

  await vi.waitFor(() => expect(harness.spawnedChildren).toHaveLength(1));
  const inputFilePath = harness.spawnedArgs[0][1];
  const recordedScript = JSON.parse(await fs.readFile(inputFilePath, "utf-8")) as {
    actionParams: Record<string, unknown>;
  };
  (harness.spawnedChildren[0] as FakeStudioProcess).exit(1);
  await runPromise;

  return {
    hasFreshSessionFlag: harness.spawnedArgs[0].includes("--fresh-session"),
    recordedActionParams: recordedScript.actionParams,
  };
};

beforeEach(async () => {
  harness.dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "muggle-generation-fresh-session-"));
  await fs.mkdir(path.join(harness.dataDir, "pkg"), { recursive: true });
  await fs.writeFile(
    path.join(harness.dataDir, "pkg", "package.json"),
    JSON.stringify({ name: "@muggleai/works", version: "0.0.0", muggleConfig: { electronAppVersion: "0.0.0" } }),
  );
  harness.spawnedArgs = [];
  harness.spawnedChildren = [];
});

afterEach(async () => {
  await fs.rm(harness.dataDir, { recursive: true, force: true });
});

describe("a local generation's fresh session", () => {
  it("honors an explicit false over a stored true, in the CLI flag and the recording", async () => {
    const generation = await runGenerationAsync({ requestedFreshSession: false, storedAlwaysStartsFreshSession: true });

    expect(generation.hasFreshSessionFlag).toBe(false);
    expect(generation.recordedActionParams).not.toHaveProperty("freshSession");
  });

  it("records an explicit true on a case whose stored flag is false", async () => {
    const generation = await runGenerationAsync({ requestedFreshSession: true, storedAlwaysStartsFreshSession: false });

    expect(generation.hasFreshSessionFlag).toBe(true);
    expect(generation.recordedActionParams.freshSession).toBe(true);
  });

  it("falls back to the stored flag when the caller omits it", async () => {
    const generation = await runGenerationAsync({ storedAlwaysStartsFreshSession: true });

    expect(generation.hasFreshSessionFlag).toBe(true);
    expect(generation.recordedActionParams.freshSession).toBe(true);
  });

  it("starts a legacy case in its shared session and records nothing", async () => {
    const generation = await runGenerationAsync({});

    expect(generation.hasFreshSessionFlag).toBe(false);
    expect(generation.recordedActionParams).not.toHaveProperty("freshSession");
  });
});
