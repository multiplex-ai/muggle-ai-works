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
});
