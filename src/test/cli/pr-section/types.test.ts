import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { E2eReportSchema } from "../../../cli/pr-section/types.js";

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

  it("parses the grouped-by-use-case fixture", () => {
    const parsed = E2eReportSchema.parse(loadFixture("grouped-by-use-case.json"));
    expect(parsed.tests).toHaveLength(3);
    expect(parsed.tests.every((t) => typeof t.useCaseName === "string")).toBe(true);
  });
});
