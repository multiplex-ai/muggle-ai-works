import { describe, expect, it } from "vitest";
import { MAX_STEPS_PER_TASK } from "../domain/constants";
import { type BenchmarkTask } from "../domain/types";
import { buildStudioArgv, buildStudioTaskFile } from "./studio-invocation";

const task: BenchmarkTask = {
  taskId: "Allrecipes--0",
  siteName: "Allrecipes",
  instruction: "Provide a recipe for vegetarian lasagna.",
  startUrl: "https://www.allrecipes.com/",
};

describe("buildStudioTaskFile", () => {
  it("carries exactly the fields studio reads, including where to write the result", () => {
    expect(
      buildStudioTaskFile({
        task: task,
        maxSteps: MAX_STEPS_PER_TASK,
        trajectoryDir: "/out/trajectories/Allrecipes--0",
        resultFilePath: "/out/trajectories/Allrecipes--0/result.json",
      }),
    ).toEqual({
      taskId: "Allrecipes--0",
      instruction: "Provide a recipe for vegetarian lasagna.",
      startUrl: "https://www.allrecipes.com/",
      maxSteps: MAX_STEPS_PER_TASK,
      trajectoryDir: "/out/trajectories/Allrecipes--0",
      outputFilePath: "/out/trajectories/Allrecipes--0/result.json",
    });
  });

  it("names the result path outputFilePath, the key studio requires", () => {
    // Studio's readBenchmarkTaskAsync rejects a task file missing this field, so
    // the spelling is the contract rather than an implementation detail.
    const taskFile = buildStudioTaskFile({
      task: task,
      maxSteps: MAX_STEPS_PER_TASK,
      trajectoryDir: "/out/trajectories/Allrecipes--0",
      resultFilePath: "/out/result.json",
    });

    expect(Object.keys(taskFile)).toContain("outputFilePath");
  });
});

describe("buildStudioArgv", () => {
  it("pins the run mode plus single-flag spawn contract", () => {
    expect(
      buildStudioArgv({
        studioBinPath: "/bin/muggle-studio",
        authFilePath: "/tmp/studio-auth.json",
        taskFilePath: "/out/trajectories/Allrecipes--0/task.json",
        resultFilePath: "/out/trajectories/Allrecipes--0/result.json",
        browserProfileDir: "/out/profiles/Allrecipes--0",
      }),
    ).toEqual([
      "explore",
      "",
      "",
      "/tmp/studio-auth.json",
      "--benchmark-task",
      "/out/trajectories/Allrecipes--0/task.json",
    ]);
  });

  it("leads with the positional run mode, which studio reads as argv[1]", () => {
    // Studio resolves the run mode positionally before scanning flags. Omit it
    // and "--benchmark-task" lands in the mode slot: the process exits with
    // "Unsupported run mode --benchmark-task" before the agent loop is reached.
    const argv = buildStudioArgv({
      studioBinPath: "/bin/muggle-studio",
        authFilePath: "/tmp/studio-auth.json",
      taskFilePath: "/out/task.json",
      resultFilePath: "/out/result.json",
      browserProfileDir: "/out/profiles/x",
    });

    expect(argv[0]).toBe("explore");
  });

  it("puts the auth file in studio's fourth positional slot", () => {
    // Studio reads mode, script, mutation params, auth file positionally. The
    // benchmark has no script or mutation params, so those slots must still be
    // present as empty strings or the auth file lands in the wrong one.
    const argv = buildStudioArgv({
      studioBinPath: "/bin/muggle-studio",
      authFilePath: "/tmp/studio-auth.json",
      taskFilePath: "/out/task.json",
      resultFilePath: "/out/result.json",
      browserProfileDir: "/out/profiles/x",
    });

    expect(argv[3]).toBe("/tmp/studio-auth.json");
  });

  it("does not pass --out; studio reads the result path from the task file", () => {
    const argv = buildStudioArgv({
      studioBinPath: "/bin/muggle-studio",
        authFilePath: "/tmp/studio-auth.json",
      taskFilePath: "/out/task.json",
      resultFilePath: "/out/result.json",
      browserProfileDir: "/out/profiles/x",
    });

    expect(argv).not.toContain("--out");
  });
});
