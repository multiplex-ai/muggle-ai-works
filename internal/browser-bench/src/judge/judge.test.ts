import { describe, expect, it } from "vitest";
import { BenchmarkOutcome } from "../domain/types";
import { judgeTaskAsync } from "./judge";

describe("judgeTaskAsync", () => {
  it("maps a SUCCESS verdict to Pass", async () => {
    const verdict = await judgeTaskAsync({
      instruction: "Find a salmon recipe.",
      finalAnswer: "Grilled Salmon I",
      screenshotPaths: [],
      invokeJudgeAsync: async () => "Thoughts: the answer matches.\nStatus: SUCCESS",
    });

    expect(verdict.outcome).toBe(BenchmarkOutcome.Pass);
  });

  it("maps NOT SUCCESS to Fail", async () => {
    const verdict = await judgeTaskAsync({
      instruction: "Find a salmon recipe.",
      finalAnswer: "I could not find it.",
      screenshotPaths: [],
      invokeJudgeAsync: async () => "Thoughts: no recipe found.\nStatus: NOT SUCCESS",
    });

    expect(verdict.outcome).toBe(BenchmarkOutcome.Fail);
  });

  it("treats an unparseable judge response as Fail, never Error", async () => {
    const verdict = await judgeTaskAsync({
      instruction: "q",
      finalAnswer: "",
      screenshotPaths: [],
      invokeJudgeAsync: async () => "unparseable",
    });

    expect(verdict.outcome).toBe(BenchmarkOutcome.Fail);
  });

  it("passes the instruction, the answer, and the screenshots to the judge", async () => {
    let seenPrompt = "";
    let seenScreenshots: string[] = [];

    await judgeTaskAsync({
      instruction: "Find a salmon recipe.",
      finalAnswer: "Grilled Salmon I",
      screenshotPaths: ["/tmp/step-01.png"],
      invokeJudgeAsync: async (prompt, screenshots) => {
        seenPrompt = prompt;
        seenScreenshots = screenshots;
        return "Status: SUCCESS";
      },
    });

    expect(seenPrompt).toContain("Find a salmon recipe.");
    expect(seenPrompt).toContain("Grilled Salmon I");
    expect(seenScreenshots).toEqual(["/tmp/step-01.png"]);
  });
});
