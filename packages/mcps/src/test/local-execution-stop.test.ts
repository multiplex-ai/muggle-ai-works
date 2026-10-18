import * as fs from "fs/promises";
import * as os from "node:os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildStopRequestFilePath,
  describeStoppedRun,
  removeStopRequestFileAsync,
  requestGracefulStopAsync,
  resolveStoppedRunStatus,
} from "../mcp/local/services/execution-stop.js";
import { STOP_REQUEST_GRACE_MS } from "../mcp/local/services/execution-stop-constants.js";
import { RunStopReasonEnum, type IStoppableProcess } from "../mcp/local/services/execution-stop-types.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

let tempDir: string;

const _runningProcess = (): IStoppableProcess & { kill: ReturnType<typeof vi.fn> } => ({
  exitCode: null,
  signalCode: null,
  kill: vi.fn(() => true),
});

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "muggle-stop-"));
});

afterEach(async () => {
  vi.useRealTimers();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("buildStopRequestFilePath", () => {
  it("names the file the studio watches, next to the run's other temp files", () => {
    expect(buildStopRequestFilePath({ tempDir: tempDir, runId: RUN_ID })).toBe(
      path.join(tempDir, `${RUN_ID}_stop_requested`),
    );
  });
});

describe("requestGracefulStopAsync", () => {
  it("writes the stop request before anything is killed", async () => {
    const child = _runningProcess();

    const hardKillTimer = await requestGracefulStopAsync({
      tempDir: tempDir,
      runId: RUN_ID,
      reason: RunStopReasonEnum.Timeout,
      child: child,
    });
    clearTimeout(hardKillTimer);

    const stopRequest = await fs.readFile(buildStopRequestFilePath({ tempDir: tempDir, runId: RUN_ID }), "utf-8");
    expect(stopRequest).toBe(RunStopReasonEnum.Timeout);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("hard-kills a process still running after the grace period", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = _runningProcess();

    await requestGracefulStopAsync({
      tempDir: tempDir,
      runId: RUN_ID,
      reason: RunStopReasonEnum.Cancelled,
      child: child,
    });

    vi.advanceTimersByTime(STOP_REQUEST_GRACE_MS - 1);
    expect(child.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("does not kill a process that exited within the grace period", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = _runningProcess();

    await requestGracefulStopAsync({
      tempDir: tempDir,
      runId: RUN_ID,
      reason: RunStopReasonEnum.Timeout,
      child: child,
    });
    child.exitCode = 1;

    vi.advanceTimersByTime(STOP_REQUEST_GRACE_MS);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("still schedules the hard kill when the stop request cannot be written", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = _runningProcess();

    await requestGracefulStopAsync({
      tempDir: path.join(tempDir, "missing", "dir"),
      runId: RUN_ID,
      reason: RunStopReasonEnum.Timeout,
      child: child,
    });

    vi.advanceTimersByTime(STOP_REQUEST_GRACE_MS);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("removeStopRequestFileAsync", () => {
  it("removes the request, and is silent when there is none", async () => {
    const child = _runningProcess();
    const hardKillTimer = await requestGracefulStopAsync({
      tempDir: tempDir,
      runId: RUN_ID,
      reason: RunStopReasonEnum.Timeout,
      child: child,
    });
    clearTimeout(hardKillTimer);

    await removeStopRequestFileAsync({ tempDir: tempDir, runId: RUN_ID });
    await expect(removeStopRequestFileAsync({ tempDir: tempDir, runId: RUN_ID })).resolves.toBeUndefined();
    await expect(fs.access(buildStopRequestFilePath({ tempDir: tempDir, runId: RUN_ID }))).rejects.toThrow();
  });
});

describe("stopped run outcome", () => {
  it("records a timed-out run as failed and a cancelled run as cancelled", () => {
    expect(resolveStoppedRunStatus(RunStopReasonEnum.Timeout)).toBe("failed");
    expect(resolveStoppedRunStatus(RunStopReasonEnum.Cancelled)).toBe("cancelled");
  });

  it("says why the run stopped", () => {
    expect(describeStoppedRun({ reason: RunStopReasonEnum.Timeout, timeoutMs: 480_000 })).toBe(
      "Run stopped: it exceeded its 480000ms time limit.",
    );
    expect(describeStoppedRun({ reason: RunStopReasonEnum.Cancelled, timeoutMs: 480_000 })).toBe(
      "Run cancelled by user.",
    );
  });
});
