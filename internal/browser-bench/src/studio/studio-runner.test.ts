import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_STEPS_PER_TASK } from "../domain/constants";
import { BenchmarkOutcome, type BenchmarkTask } from "../domain/types";
import { runStudioTaskAsync } from "./studio-runner";
import {
  type StudioExitReport,
  type StudioInvocation,
  type StudioProcess,
  type TaskFileSystem,
} from "./types";

const OUT_DIR = path.join("/out");

const task: BenchmarkTask = {
  taskId: "Allrecipes--0",
  siteName: "Allrecipes",
  instruction: "Provide a recipe for vegetarian lasagna.",
  startUrl: "https://www.allrecipes.com/",
};

const successfulResultFile = JSON.stringify({
  taskId: "Allrecipes--0",
  finalAnswer: "Vegetarian lasagna, 4.6 stars.",
  studioStatus: "success",
  stepCount: 7,
  durationMs: 41_230,
  trajectoryDir: path.join(OUT_DIR, "trajectories", "Allrecipes--0"),
});

const createFakeFileSystem = (resultFileContent?: string) => {
  const recreatedDirs: string[] = [];
  const writtenFiles = new Map<string, string>();

  const fileSystem: TaskFileSystem = {
    recreateDirAsync: async (dirPath: string): Promise<void> => {
      recreatedDirs.push(dirPath);
    },
    writeTextAsync: async (filePath: string, content: string): Promise<void> => {
      writtenFiles.set(filePath, content);
    },
    readTextAsync: async (filePath: string): Promise<string> => {
      if (resultFileContent === undefined) throw new Error(`ENOENT: ${filePath}`);
      return resultFileContent;
    },
  };

  return { fileSystem: fileSystem, recreatedDirs: recreatedDirs, writtenFiles: writtenFiles };
};

const createFakeSpawn = (exitReport: Promise<StudioExitReport>) => {
  const invocations: StudioInvocation[] = [];
  let killCount = 0;

  const spawnStudio = (invocation: StudioInvocation): StudioProcess => {
    invocations.push(invocation);
    return {
      exitReport: exitReport,
      kill: () => {
        killCount += 1;
      },
    };
  };

  return {
    spawnStudio: spawnStudio,
    invocations: invocations,
    killCount: () => killCount,
  };
};

const cleanExit: StudioExitReport = { exitCode: 0, stderrTail: "" };

describe("runStudioTaskAsync", () => {
  it("maps a clean run's result file onto a TaskResult", async () => {
    const { fileSystem } = createFakeFileSystem(successfulResultFile);
    const { spawnStudio } = createFakeSpawn(Promise.resolve(cleanExit));

    const taskResult = await runStudioTaskAsync({
      task: task,
      outDir: OUT_DIR,
      studioBinPath: "muggle-studio",
      maxSteps: MAX_STEPS_PER_TASK,
      taskTimeoutMs: 1_000,
      spawnStudio: spawnStudio,
      fileSystem: fileSystem,
    });

    expect(taskResult).toMatchObject({
      taskId: "Allrecipes--0",
      outcome: BenchmarkOutcome.Pass,
      stepCount: 7,
      durationMs: 41_230,
      tokensUsed: 0,
    });
  });

  it("writes the task file into the task's own trajectory directory", async () => {
    const { fileSystem, writtenFiles } = createFakeFileSystem(successfulResultFile);
    const { spawnStudio, invocations } = createFakeSpawn(Promise.resolve(cleanExit));

    await runStudioTaskAsync({
      task: task,
      outDir: OUT_DIR,
      studioBinPath: "muggle-studio",
      maxSteps: MAX_STEPS_PER_TASK,
      taskTimeoutMs: 1_000,
      spawnStudio: spawnStudio,
      fileSystem: fileSystem,
    });

    const trajectoryDir = path.join(OUT_DIR, "trajectories", "Allrecipes--0");
    const taskFilePath = path.join(trajectoryDir, "task.json");

    expect(invocations[0].taskFilePath).toBe(taskFilePath);
    expect(invocations[0].resultFilePath).toBe(path.join(trajectoryDir, "result.json"));
    expect(JSON.parse(writtenFiles.get(taskFilePath) ?? "")).toEqual({
      taskId: "Allrecipes--0",
      instruction: "Provide a recipe for vegetarian lasagna.",
      startUrl: "https://www.allrecipes.com/",
      maxSteps: MAX_STEPS_PER_TASK,
      trajectoryDir: trajectoryDir,
    });
  });

  it("empties a fresh trajectory and browser profile directory per task", async () => {
    const { fileSystem, recreatedDirs } = createFakeFileSystem(
      JSON.stringify({
        taskId: "BBC News--0",
        finalAnswer: "",
        studioStatus: "success",
        stepCount: 1,
        durationMs: 5,
        trajectoryDir: "",
      }),
    );
    const { spawnStudio, invocations } = createFakeSpawn(Promise.resolve(cleanExit));

    await runStudioTaskAsync({
      task: { ...task, taskId: "BBC News--0" },
      outDir: OUT_DIR,
      studioBinPath: "muggle-studio",
      maxSteps: MAX_STEPS_PER_TASK,
      taskTimeoutMs: 1_000,
      spawnStudio: spawnStudio,
      fileSystem: fileSystem,
    });

    expect(recreatedDirs).toEqual([
      path.join(OUT_DIR, "trajectories", "BBC_News--0"),
      path.join(OUT_DIR, "profiles", "BBC_News--0"),
    ]);
    expect(invocations[0].browserProfileDir).toBe(path.join(OUT_DIR, "profiles", "BBC_News--0"));
  });

  it("throws with the exit code and stderr when studio exits non-zero", async () => {
    const { fileSystem } = createFakeFileSystem(successfulResultFile);
    const { spawnStudio } = createFakeSpawn(
      Promise.resolve({ exitCode: 9, stderrTail: "chromium failed to launch" }),
    );

    await expect(
      runStudioTaskAsync({
        task: task,
        outDir: OUT_DIR,
        studioBinPath: "muggle-studio",
        maxSteps: MAX_STEPS_PER_TASK,
        taskTimeoutMs: 1_000,
        spawnStudio: spawnStudio,
        fileSystem: fileSystem,
      }),
    ).rejects.toThrow(/exited 9 for task Allrecipes--0.*chromium failed to launch/);
  });

  it("kills studio and throws when the task outlives its budget", async () => {
    const { fileSystem } = createFakeFileSystem(successfulResultFile);
    const neverExits = new Promise<StudioExitReport>(() => undefined);
    const { spawnStudio, killCount } = createFakeSpawn(neverExits);

    await expect(
      runStudioTaskAsync({
        task: task,
        outDir: OUT_DIR,
        studioBinPath: "muggle-studio",
        maxSteps: MAX_STEPS_PER_TASK,
        taskTimeoutMs: 5,
        spawnStudio: spawnStudio,
        fileSystem: fileSystem,
      }),
    ).rejects.toThrow(/exceeded its 5 ms budget; studio was killed/);

    expect(killCount()).toBe(1);
  });

  it("throws when studio exits 0 but leaves no result file", async () => {
    const { fileSystem } = createFakeFileSystem();
    const { spawnStudio } = createFakeSpawn(Promise.resolve(cleanExit));

    await expect(
      runStudioTaskAsync({
        task: task,
        outDir: OUT_DIR,
        studioBinPath: "muggle-studio",
        maxSteps: MAX_STEPS_PER_TASK,
        taskTimeoutMs: 1_000,
        spawnStudio: spawnStudio,
        fileSystem: fileSystem,
      }),
    ).rejects.toThrow(/exited 0 for task Allrecipes--0 but wrote no result file/);
  });

  it("surfaces a spawn failure so the orchestrator records an infrastructure error", async () => {
    const { fileSystem } = createFakeFileSystem(successfulResultFile);
    const { spawnStudio } = createFakeSpawn(
      new Promise<StudioExitReport>((_resolve, reject) => {
        setTimeout(() => reject(new Error("ENOENT muggle-studio")), 0);
      }),
    );

    await expect(
      runStudioTaskAsync({
        task: task,
        outDir: OUT_DIR,
        studioBinPath: "muggle-studio",
        maxSteps: MAX_STEPS_PER_TASK,
        taskTimeoutMs: 1_000,
        spawnStudio: spawnStudio,
        fileSystem: fileSystem,
      }),
    ).rejects.toThrow(/ENOENT muggle-studio/);
  });
});
