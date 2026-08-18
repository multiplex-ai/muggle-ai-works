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
  it("carries exactly the fields studio reads", () => {
    expect(
      buildStudioTaskFile({
        task: task,
        maxSteps: MAX_STEPS_PER_TASK,
        trajectoryDir: "/out/trajectories/Allrecipes--0",
      }),
    ).toEqual({
      taskId: "Allrecipes--0",
      instruction: "Provide a recipe for vegetarian lasagna.",
      startUrl: "https://www.allrecipes.com/",
      maxSteps: MAX_STEPS_PER_TASK,
      trajectoryDir: "/out/trajectories/Allrecipes--0",
    });
  });
});

describe("buildStudioArgv", () => {
  it("pins the two-flag spawn contract", () => {
    expect(
      buildStudioArgv({
        studioBinPath: "/bin/muggle-studio",
        taskFilePath: "/out/trajectories/Allrecipes--0/task.json",
        resultFilePath: "/out/trajectories/Allrecipes--0/result.json",
        browserProfileDir: "/out/profiles/Allrecipes--0",
      }),
    ).toEqual([
      "--benchmark-task",
      "/out/trajectories/Allrecipes--0/task.json",
      "--out",
      "/out/trajectories/Allrecipes--0/result.json",
    ]);
  });
});
