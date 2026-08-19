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
  it("pins the single-flag spawn contract", () => {
    expect(
      buildStudioArgv({
        studioBinPath: "/bin/muggle-studio",
        taskFilePath: "/out/trajectories/Allrecipes--0/task.json",
        resultFilePath: "/out/trajectories/Allrecipes--0/result.json",
        browserProfileDir: "/out/profiles/Allrecipes--0",
      }),
    ).toEqual(["--benchmark-task", "/out/trajectories/Allrecipes--0/task.json"]);
  });

  it("does not pass --out; studio reads the result path from the task file", () => {
    const argv = buildStudioArgv({
      studioBinPath: "/bin/muggle-studio",
      taskFilePath: "/out/task.json",
      resultFilePath: "/out/result.json",
      browserProfileDir: "/out/profiles/x",
    });

    expect(argv).not.toContain("--out");
  });
});
