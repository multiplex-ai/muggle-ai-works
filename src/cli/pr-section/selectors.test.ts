import { describe, it, expect } from "vitest";

import { selectHero, buildOneLiner } from "./selectors.js";
import type { E2eReport } from "./types.js";

function report(partial: Partial<E2eReport> = {}): E2eReport {
  return { projectId: "p1", tests: [], ...partial };
}

describe("selectHero", () => {
  it("returns null when there are no tests", () => {
    expect(selectHero(report())).toBeNull();
  });

  it("returns the first failed test's failure-step screenshot when any failed", () => {
    const hero = selectHero(
      report({
        tests: [
          {
            name: "A",
            testCaseId: "a",
            runId: "ra",
            viewUrl: "https://x/a",
            status: "passed",
            steps: [{ stepIndex: 0, action: "act", screenshotUrl: "https://s/a0" }],
          },
          {
            name: "B",
            testCaseId: "b",
            runId: "rb",
            viewUrl: "https://x/b",
            status: "failed",
            failureStepIndex: 1,
            error: "boom",
            steps: [
              { stepIndex: 0, action: "act0", screenshotUrl: "https://s/b0" },
              { stepIndex: 1, action: "act1", screenshotUrl: "https://s/b1" },
            ],
          },
        ],
      }),
    );
    expect(hero).toEqual({
      screenshotUrl: "https://s/b1",
      testName: "B",
      kind: "failure",
    });
  });

  it("returns the first passed test's last-step screenshot when all passed", () => {
    const hero = selectHero(
      report({
        tests: [
          {
            name: "A",
            testCaseId: "a",
            runId: "ra",
            viewUrl: "https://x/a",
            status: "passed",
            steps: [
              { stepIndex: 0, action: "act0", screenshotUrl: "https://s/a0" },
              { stepIndex: 1, action: "act1", screenshotUrl: "https://s/a1" },
            ],
          },
        ],
      }),
    );
    expect(hero).toEqual({
      screenshotUrl: "https://s/a1",
      testName: "A",
      kind: "final",
    });
  });

  it("returns null for a passed test with zero steps", () => {
    const hero = selectHero(
      report({
        tests: [
          {
            name: "A",
            testCaseId: "a",
            runId: "ra",
            viewUrl: "https://x/a",
            status: "passed",
            steps: [],
          },
        ],
      }),
    );
    expect(hero).toBeNull();
  });
});

describe("buildOneLiner", () => {
  it("returns the all-passed sentence", () => {
    expect(
      buildOneLiner(
        report({
          tests: [
            { name: "A", testCaseId: "a", runId: "ra", viewUrl: "https://x/a", status: "passed", steps: [] },
            { name: "B", testCaseId: "b", runId: "rb", viewUrl: "https://x/b", status: "passed", steps: [] },
          ],
        }),
      ),
    ).toBe("All 2 acceptance tests passed.");
  });

  it("returns the zero-tests sentence", () => {
    expect(buildOneLiner(report())).toBe("No acceptance tests were executed.");
  });

  it("returns the any-failed sentence with first-failed details", () => {
    expect(
      buildOneLiner(
        report({
          tests: [
            { name: "A", testCaseId: "a", runId: "ra", viewUrl: "https://x/a", status: "passed", steps: [] },
            {
              name: "Checkout flow",
              testCaseId: "b",
              runId: "rb",
              viewUrl: "https://x/b",
              status: "failed",
              failureStepIndex: 2,
              error: "Element not found",
              steps: [],
            },
          ],
        }),
      ),
    ).toBe('1 of 2 failed — "Checkout flow" broke at step 2: Element not found.');
  });

  it("truncates long error messages in the one-liner", () => {
    const longErr = "a".repeat(200);
    const line = buildOneLiner(
      report({
        tests: [
          {
            name: "X",
            testCaseId: "b",
            runId: "rb",
            viewUrl: "https://x/b",
            status: "failed",
            failureStepIndex: 0,
            error: longErr,
            steps: [],
          },
        ],
      }),
    );
    expect(line.length).toBeLessThanOrEqual(200);
    expect(line).toContain("…");
  });
});
