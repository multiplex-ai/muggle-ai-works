import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { E2eReportSchema, RunSummaryVerdictStatusEnum } from "../../../cli/pr-section/types.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8"));
}

describe("E2eReportSchema", () => {
  it("parses an all-passed report", () => {
    const parsed = E2eReportSchema.parse(loadFixture("all-passed.json"));
    expect(parsed.projectId).toBeTruthy();
    expect(parsed.tests).toHaveLength(3);
    expect(parsed.tests.every((t) => t.status === "passed")).toBe(true);
  });

  it("parses a report with one failed test", () => {
    const parsed = E2eReportSchema.parse(loadFixture("one-failed.json"));
    const failed = parsed.tests.filter((t) => t.status === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].status).toBe("failed");
    if (failed[0].status === "failed") {
      expect(failed[0].failureStepIndex).toBeGreaterThanOrEqual(0);
      expect(failed[0].error).toBeTruthy();
    }
  });

  it("rejects a report with missing projectId", () => {
    expect(() => E2eReportSchema.parse({ tests: [] })).toThrow();
  });

  it("rejects a failed test that has no error field", () => {
    const bad = {
      projectId: "p1",
      tests: [
        {
          name: "x",
          testCaseId: "tc1",
          runId: "r1",
          viewUrl: "https://example.com/x",
          status: "failed",
          steps: [{ stepIndex: 0, action: "click", screenshotUrl: "https://s/1" }],
          failureStepIndex: 0,
        },
      ],
    };
    expect(() => E2eReportSchema.parse(bad)).toThrow();
  });

  it("rejects an invalid status value", () => {
    const bad = {
      projectId: "p1",
      tests: [
        {
          name: "x",
          testCaseId: "tc1",
          runId: "r1",
          viewUrl: "https://example.com/x",
          status: "unknown",
          steps: [],
        },
      ],
    };
    expect(() => E2eReportSchema.parse(bad)).toThrow();
  });

  it("accepts optional useCaseName and description on passed tests", () => {
    const parsed = E2eReportSchema.parse({
      projectId: "p1",
      tests: [
        {
          name: "Login works",
          description: "Verify login succeeds for a valid user.",
          useCaseName: "User Authentication",
          testCaseId: "tc1",
          runId: "r1",
          viewUrl: "https://example.com/x",
          status: "passed",
          steps: [{ stepIndex: 0, action: "click", screenshotUrl: "https://s/1" }],
        },
      ],
    });
    expect(parsed.tests[0].useCaseName).toBe("User Authentication");
    expect(parsed.tests[0].description).toBe("Verify login succeeds for a valid user.");
  });

  it("accepts optional useCaseName and description on failed tests", () => {
    const parsed = E2eReportSchema.parse({
      projectId: "p1",
      tests: [
        {
          name: "Checkout breaks",
          description: "Verify checkout with saved card.",
          useCaseName: "Purchase",
          testCaseId: "tc1",
          runId: "r1",
          viewUrl: "https://example.com/x",
          status: "failed",
          steps: [{ stepIndex: 0, action: "click", screenshotUrl: "https://s/1" }],
          failureStepIndex: 0,
          error: "Click failed",
        },
      ],
    });
    const t = parsed.tests[0];
    expect(t.useCaseName).toBe("Purchase");
    expect(t.description).toBe("Verify checkout with saved card.");
  });

  it("accepts tests with useCaseName and description omitted entirely", () => {
    const parsed = E2eReportSchema.parse({
      projectId: "p1",
      tests: [
        {
          name: "Bare test",
          testCaseId: "tc1",
          runId: "r1",
          viewUrl: "https://example.com/x",
          status: "passed",
          steps: [{ stepIndex: 0, action: "click", screenshotUrl: "https://s/1" }],
        },
      ],
    });
    expect(parsed.tests[0].useCaseName).toBeUndefined();
    expect(parsed.tests[0].description).toBeUndefined();
  });

  it("rejects empty-string useCaseName and description", () => {
    const bad = {
      projectId: "p1",
      tests: [
        {
          name: "X",
          testCaseId: "tc1",
          runId: "r1",
          viewUrl: "https://example.com/x",
          status: "passed",
          steps: [{ stepIndex: 0, action: "click", screenshotUrl: "https://s/1" }],
          useCaseName: "",
        },
      ],
    };
    expect(() => E2eReportSchema.parse(bad)).toThrow();
  });

  it("accepts an inconclusive test with reason + same identifiers as passed/failed", () => {
    const parsed = E2eReportSchema.parse({
      projectId: "p1",
      tests: [
        {
          name: "Clear search input restores full list",
          testCaseId: "tc1",
          runId: "r1",
          viewUrl: "https://example.com/run-1",
          status: "inconclusive",
          steps: [],
          reason: "No replayable script exists yet — needs first generation run.",
        },
      ],
    });
    const t = parsed.tests[0];
    expect(t.status).toBe("inconclusive");
    if (t.status === "inconclusive") {
      expect(t.reason).toContain("No replayable script");
      expect(t.steps).toHaveLength(0);
    }
  });

  it("rejects an inconclusive test that has no reason field", () => {
    const bad = {
      projectId: "p1",
      tests: [
        {
          name: "x",
          testCaseId: "tc1",
          runId: "r1",
          viewUrl: "https://example.com/x",
          status: "inconclusive",
          steps: [],
        },
      ],
    };
    expect(() => E2eReportSchema.parse(bad)).toThrow();
  });

  it("rejects an inconclusive test that omits required runId/viewUrl", () => {
    const bad = {
      projectId: "p1",
      tests: [
        {
          name: "x",
          testCaseId: "tc1",
          status: "inconclusive",
          steps: [],
          reason: "prereq unmet",
        },
      ],
    };
    expect(() => E2eReportSchema.parse(bad)).toThrow();
  });

  it("parses the grouped-by-use-case fixture", () => {
    const parsed = E2eReportSchema.parse(loadFixture("grouped-by-use-case.json"));
    expect(parsed.tests).toHaveLength(3);
    expect(parsed.tests.every((t) => typeof t.useCaseName === "string")).toBe(true);
  });
});

describe("step description", () => {
  const reportWithStep = (step: Record<string, unknown>) => ({
    projectId: "p1",
    tests: [
      {
        name: "Header links",
        testCaseId: "tc1",
        runId: "r1",
        viewUrl: "https://example.com/x",
        status: "passed",
        steps: [step],
      },
    ],
  });

  it("carries the agent's explanation alongside the operation verb", () => {
    const parsed = E2eReportSchema.parse(
      reportWithStep({
        stepIndex: 1,
        action: "click",
        description: "Click 'Accept all' button to dismiss the cookie consent dialog.",
        screenshotUrl: "https://s/1",
      }),
    );
    expect(parsed.tests[0].steps[0].description).toBe("Click 'Accept all' button to dismiss the cookie consent dialog.");
  });

  // Reports assembled before the field existed must still parse.
  it("is optional", () => {
    expect(() => E2eReportSchema.parse(reportWithStep({ stepIndex: 0, action: "click", screenshotUrl: "https://s/1" }))).not.toThrow();
  });

  it("rejects an empty description rather than rendering a blank step", () => {
    expect(() =>
      E2eReportSchema.parse(reportWithStep({ stepIndex: 0, action: "click", description: "", screenshotUrl: "https://s/1" })),
    ).toThrow();
  });
});

describe("E2eReportSchema runSummary", () => {
  /** A one-test passed report carrying the given runSummary. */
  function reportWithRunSummary (runSummary: unknown): unknown {
    return {
      projectId: "p1",
      tests: [
        {
          name: "x",
          testCaseId: "tc1",
          runId: "r1",
          viewUrl: "https://example.com/x",
          status: "passed",
          steps: [],
          runSummary: runSummary,
        },
      ],
    };
  }

  it("parses every test of the summary fixture, recorded or missing", () => {
    const parsed = E2eReportSchema.parse(loadFixture("run-summary.json"));
    expect(parsed.tests.map((t) => t.runSummary?.isRecorded)).toEqual([true, true, false]);
    const failedSummary = parsed.tests[1].runSummary;
    expect(failedSummary?.isRecorded && failedSummary.status).toBe(RunSummaryVerdictStatusEnum.BugDetected);
  });

  it("accepts a recorded summary carrying only its headline", () => {
    expect(() => E2eReportSchema.parse(reportWithRunSummary({ isRecorded: true, headline: "Done" }))).not.toThrow();
  });

  it("rejects a recorded summary without a headline", () => {
    expect(() => E2eReportSchema.parse(reportWithRunSummary({ isRecorded: true, status: "success" }))).toThrow();
  });

  it("rejects a verdict status the summarizer never stamps", () => {
    expect(() => E2eReportSchema.parse(reportWithRunSummary({ isRecorded: true, headline: "Done", status: "passed" }))).toThrow();
  });

  it("rejects a summary screenshot that is not a URL", () => {
    expect(() => E2eReportSchema.parse(reportWithRunSummary({ isRecorded: true, headline: "Done", screenshotUrl: "frame.png" }))).toThrow();
  });

  it("parses a report whose tests carry no runSummary", () => {
    const parsed = E2eReportSchema.parse(loadFixture("all-passed.json"));
    expect(parsed.tests.every((t) => t.runSummary === undefined)).toBe(true);
  });
});
