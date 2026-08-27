import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { BenchmarkOutcome, type TaskResult } from "../domain/types";
import { applyJudgeVerdict, resolveTrajectoryScreenshotPaths } from "./judged-result";

const studioClaimedPass: TaskResult = {
  taskId: "Allrecipes--0",
  outcome: BenchmarkOutcome.Pass,
  finalAnswer: "Found a lasagna recipe.",
  studioStatus: "success",
  stepCount: 7,
  durationMs: 41_230,
  tokensUsed: 0,
  trajectoryDir: "C:/out/trajectories/Allrecipes--0",
};

describe("applyJudgeVerdict", () => {
  it("overrules studio's own claim of success", () => {
    // Studio reporting "success" means it stopped without erroring, not that the
    // task was achieved. Only the judge decides the score.
    const judged = applyJudgeVerdict({
      taskResult: studioClaimedPass,
      verdict: { outcome: BenchmarkOutcome.Fail, reasoning: "Wrong recipe." },
    });

    expect(judged.outcome).toBe(BenchmarkOutcome.Fail);
  });

  it("records the verdict and its reasoning alongside studio's claim", () => {
    const judged = applyJudgeVerdict({
      taskResult: studioClaimedPass,
      verdict: { outcome: BenchmarkOutcome.Fail, reasoning: "Wrong recipe." },
    });

    expect(judged.judgeVerdict).toBe(BenchmarkOutcome.Fail);
    expect(judged.judgeReasoning).toBe("Wrong recipe.");
    expect(judged.studioStatus).toBe("success");
  });

  it("leaves every other field untouched", () => {
    const judged = applyJudgeVerdict({
      taskResult: studioClaimedPass,
      verdict: { outcome: BenchmarkOutcome.Pass, reasoning: "Correct." },
    });

    expect(judged).toMatchObject({
      taskId: "Allrecipes--0",
      stepCount: 7,
      durationMs: 41_230,
      trajectoryDir: "C:/out/trajectories/Allrecipes--0",
    });
  });
});

describe("resolveTrajectoryScreenshotPaths", () => {
  it("resolves each basename against the trajectory directory", () => {
    const paths = resolveTrajectoryScreenshotPaths({
      trajectoryDir: "C:/out/trajectories/Allrecipes--0",
      manifestContent: JSON.stringify({ screenshots: ["step001.png", "step002.png"] }),
    });

    // Joined with the platform's own separator — these paths are handed to the
    // filesystem, not compared as strings.
    expect(paths).toEqual([
      path.join("C:/out/trajectories/Allrecipes--0", "step001.png"),
      path.join("C:/out/trajectories/Allrecipes--0", "step002.png"),
    ]);
  });

  it("returns nothing when the attempt captured no screenshots", () => {
    expect(
      resolveTrajectoryScreenshotPaths({
        trajectoryDir: "C:/out/t",
        manifestContent: JSON.stringify({ screenshots: [] }),
      }),
    ).toEqual([]);
  });

  it("throws on a manifest whose screenshots field is not a list of names", () => {
    // Silently treating a malformed manifest as "no screenshots" would judge the
    // attempt blind and report the result as if it had been seen.
    expect(() =>
      resolveTrajectoryScreenshotPaths({
        trajectoryDir: "C:/out/t",
        manifestContent: JSON.stringify({ screenshots: "step001.png" }),
      }),
    ).toThrow(/screenshots/i);
  });

  it("throws on a manifest that is not JSON", () => {
    expect(() =>
      resolveTrajectoryScreenshotPaths({ trajectoryDir: "C:/out/t", manifestContent: "not json" }),
    ).toThrow(/JSON/i);
  });
});
