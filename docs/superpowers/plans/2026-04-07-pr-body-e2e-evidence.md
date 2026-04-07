# PR Body E2E Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, unit-tested helper that renders an E2E acceptance report into a single evidence block for the `muggle-do` PR description (with comment overflow when oversized), and rewire the `open-prs.md` skill to use it.

**Architecture:** Add a new `muggle build-pr-section` CLI subcommand. It reads a JSON e2e-acceptance report from stdin, validates it with Zod, runs pure renderer functions to produce body + (optional) comment markdown, and writes `{body, comment}` JSON to stdout. The renderer lives as small pure modules under `src/cli/pr-section/` (types, selectors, render, overflow, index), each with sibling `*.test.ts` tests. `open-prs.md` calls the CLI, pastes `.body` into the PR, and posts `.comment` as a follow-up only when present.

**Tech Stack:** TypeScript, Zod (already a dep), Vitest (root `vitest.config.ts`, tests must live under `src/` to be picked up), Commander (already wired in `packages/commands/src/cli/run-cli.ts`).

**Product spec:** `../../../muggle-ai-brain/product/pr-body-e2e-evidence-design.md`

---

## File Structure

```
muggle-ai-works/src/cli/
├── build-pr-section.ts              # CLI handler (stdin → stdout)
├── build-pr-section.test.ts         # handler integration test
└── pr-section/
    ├── types.ts                      # Zod schema + TS types for e2e report
    ├── types.test.ts                 # schema validation tests
    ├── selectors.ts                  # hero screenshot + one-liner logic
    ├── selectors.test.ts
    ├── render.ts                     # summary, row, details, body, comment emitters
    ├── render.test.ts
    ├── overflow.ts                   # fit-or-overflow split logic
    ├── overflow.test.ts
    ├── index.ts                      # top-level buildPrSection() API
    ├── index.test.ts
    └── fixtures/
        ├── all-passed.json           # 3 passing tests
        ├── one-failed.json           # 1 failed + 2 passed
        └── oversized.json            # triggers overflow to comment
```

**Wiring (existing files touched):**
- `packages/commands/src/handlers/index.ts` — re-export the new handler.
- `packages/commands/src/cli/run-cli.ts` — register the new subcommand.
- `plugin/skills/do/open-prs.md` — replace the E2E results format section and update the comment rule.

**Out of new-file scope:**
- No new test runner, no new package, no new build step.
- No changes to e2e-acceptance.md (the report shape is already what's consumed).
- No migrations of existing PRs.

---

## Constants

These appear in multiple tasks — define once, reuse:

```ts
// src/cli/pr-section/render.ts
export const DASHBOARD_URL_BASE =
  "https://www.muggle-ai.com/muggleTestV0/dashboard/projects";

// src/cli/build-pr-section.ts
export const DEFAULT_MAX_BODY_BYTES = 60_000; // GitHub PR body cap is 65_536; leave headroom for Goal/AC/Changes
```

---

## Task 1: Zod input contract for the e2e report

**Files:**
- Create: `src/cli/pr-section/types.ts`
- Create: `src/cli/pr-section/types.test.ts`
- Create: `src/cli/pr-section/fixtures/all-passed.json`
- Create: `src/cli/pr-section/fixtures/one-failed.json`

**Context:** The `e2e-acceptance.md` skill produces a report with per-test-case metadata: `name`, `testCaseId`, `testScriptId?`, `runId`, `viewUrl`, `status` (passed/failed), `steps[]`, and for failures `failureStepIndex`, `error`, `artifactsDir`. Plus top-level `projectId`. This task locks that shape into a Zod schema so downstream code can rely on it and invalid inputs fail loudly at the CLI boundary.

- [ ] **Step 1: Write the failing schema test**

Create `src/cli/pr-section/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { E2eReportSchema } from "./types.js";

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
    expect(failed[0].failureStepIndex).toBeGreaterThanOrEqual(0);
    expect(failed[0].error).toBeTruthy();
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
          // no error, no artifactsDir
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
```

Create `src/cli/pr-section/fixtures/all-passed.json`:

```json
{
  "projectId": "5365f324-5c5f-4adf-b702-11f457b29b04",
  "tests": [
    {
      "name": "Login flow",
      "testCaseId": "tc-1",
      "testScriptId": "ts-1",
      "runId": "run-1",
      "viewUrl": "https://www.muggle-ai.com/muggleTestV0/dashboard/runs/run-1",
      "status": "passed",
      "steps": [
        { "stepIndex": 0, "action": "Navigate to /login", "screenshotUrl": "https://cdn.muggle.ai/run-1/0.png" },
        { "stepIndex": 1, "action": "Enter username", "screenshotUrl": "https://cdn.muggle.ai/run-1/1.png" },
        { "stepIndex": 2, "action": "Click Sign In", "screenshotUrl": "https://cdn.muggle.ai/run-1/2.png" }
      ]
    },
    {
      "name": "Dashboard renders",
      "testCaseId": "tc-2",
      "testScriptId": "ts-2",
      "runId": "run-2",
      "viewUrl": "https://www.muggle-ai.com/muggleTestV0/dashboard/runs/run-2",
      "status": "passed",
      "steps": [
        { "stepIndex": 0, "action": "Open /dashboard", "screenshotUrl": "https://cdn.muggle.ai/run-2/0.png" },
        { "stepIndex": 1, "action": "Verify charts visible", "screenshotUrl": "https://cdn.muggle.ai/run-2/1.png" }
      ]
    },
    {
      "name": "Logout flow",
      "testCaseId": "tc-3",
      "testScriptId": "ts-3",
      "runId": "run-3",
      "viewUrl": "https://www.muggle-ai.com/muggleTestV0/dashboard/runs/run-3",
      "status": "passed",
      "steps": [
        { "stepIndex": 0, "action": "Click user menu", "screenshotUrl": "https://cdn.muggle.ai/run-3/0.png" },
        { "stepIndex": 1, "action": "Click Logout", "screenshotUrl": "https://cdn.muggle.ai/run-3/1.png" }
      ]
    }
  ]
}
```

Create `src/cli/pr-section/fixtures/one-failed.json`:

```json
{
  "projectId": "5365f324-5c5f-4adf-b702-11f457b29b04",
  "tests": [
    {
      "name": "Login flow",
      "testCaseId": "tc-1",
      "testScriptId": "ts-1",
      "runId": "run-1",
      "viewUrl": "https://www.muggle-ai.com/muggleTestV0/dashboard/runs/run-1",
      "status": "passed",
      "steps": [
        { "stepIndex": 0, "action": "Navigate to /login", "screenshotUrl": "https://cdn.muggle.ai/run-1/0.png" },
        { "stepIndex": 1, "action": "Enter username", "screenshotUrl": "https://cdn.muggle.ai/run-1/1.png" },
        { "stepIndex": 2, "action": "Click Sign In", "screenshotUrl": "https://cdn.muggle.ai/run-1/2.png" }
      ]
    },
    {
      "name": "Checkout flow",
      "testCaseId": "tc-2",
      "testScriptId": "ts-2",
      "runId": "run-2",
      "viewUrl": "https://www.muggle-ai.com/muggleTestV0/dashboard/runs/run-2",
      "status": "failed",
      "failureStepIndex": 2,
      "error": "Element not found: button[data-testid='confirm-order']",
      "artifactsDir": "/tmp/muggle-runs/run-2",
      "steps": [
        { "stepIndex": 0, "action": "Add item to cart", "screenshotUrl": "https://cdn.muggle.ai/run-2/0.png" },
        { "stepIndex": 1, "action": "View cart", "screenshotUrl": "https://cdn.muggle.ai/run-2/1.png" },
        { "stepIndex": 2, "action": "Click confirm", "screenshotUrl": "https://cdn.muggle.ai/run-2/2.png" }
      ]
    },
    {
      "name": "Profile page",
      "testCaseId": "tc-3",
      "testScriptId": "ts-3",
      "runId": "run-3",
      "viewUrl": "https://www.muggle-ai.com/muggleTestV0/dashboard/runs/run-3",
      "status": "passed",
      "steps": [
        { "stepIndex": 0, "action": "Open profile", "screenshotUrl": "https://cdn.muggle.ai/run-3/0.png" }
      ]
    }
  ]
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/cli/pr-section/types.test.ts`
Expected: FAIL — `Cannot find module './types.js'`.

- [ ] **Step 3: Implement the schema**

Create `src/cli/pr-section/types.ts`:

```ts
/**
 * Zod schema and TypeScript types for the e2e-acceptance report that
 * muggle-do's e2e-acceptance agent produces and build-pr-section consumes.
 */

import { z } from "zod";

const StepSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  action: z.string().min(1),
  screenshotUrl: z.string().url(),
});

const PassedTestSchema = z.object({
  name: z.string().min(1),
  testCaseId: z.string().min(1),
  testScriptId: z.string().min(1).optional(),
  runId: z.string().min(1),
  viewUrl: z.string().url(),
  status: z.literal("passed"),
  steps: z.array(StepSchema),
});

const FailedTestSchema = z.object({
  name: z.string().min(1),
  testCaseId: z.string().min(1),
  testScriptId: z.string().min(1).optional(),
  runId: z.string().min(1),
  viewUrl: z.string().url(),
  status: z.literal("failed"),
  steps: z.array(StepSchema),
  failureStepIndex: z.number().int().nonnegative(),
  error: z.string().min(1),
  artifactsDir: z.string().min(1).optional(),
});

const TestResultSchema = z.discriminatedUnion("status", [
  PassedTestSchema,
  FailedTestSchema,
]);

export const E2eReportSchema = z.object({
  projectId: z.string().min(1),
  tests: z.array(TestResultSchema),
});

export type E2eReport = z.infer<typeof E2eReportSchema>;
export type TestResult = z.infer<typeof TestResultSchema>;
export type PassedTest = z.infer<typeof PassedTestSchema>;
export type FailedTest = z.infer<typeof FailedTestSchema>;
export type Step = z.infer<typeof StepSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/cli/pr-section/types.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli/pr-section/types.ts src/cli/pr-section/types.test.ts \
  src/cli/pr-section/fixtures/all-passed.json \
  src/cli/pr-section/fixtures/one-failed.json
git commit -m "feat(pr-section): add zod schema for e2e-acceptance report"
```

---

## Task 2: Selectors — hero screenshot + executive one-liner

**Files:**
- Create: `src/cli/pr-section/selectors.ts`
- Create: `src/cli/pr-section/selectors.test.ts`

**Context:** Two deterministic functions derive summary-block inputs from the report:
- `selectHero(report)` picks the hero screenshot (first failed test's failure step, else first passed test's last step, else null).
- `buildOneLiner(report)` writes the single-sentence verdict.

Both are pure and have no markdown in them — they return data. Markdown is built in `render.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/cli/pr-section/selectors.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/cli/pr-section/selectors.test.ts`
Expected: FAIL — `Cannot find module './selectors.js'`.

- [ ] **Step 3: Implement the selectors**

Create `src/cli/pr-section/selectors.ts`:

```ts
/**
 * Deterministic selectors that derive summary-block inputs from an e2e report.
 * Pure: no markdown, no I/O, no randomness.
 */

import type { E2eReport, FailedTest, PassedTest } from "./types.js";

/**
 * Hero screenshot used at the top of the evidence block.
 */
export interface IHero {
  /** Cloud URL of the hero screenshot. */
  screenshotUrl: string;
  /** Name of the test the screenshot came from (for alt text + caption). */
  testName: string;
  /** Why this screenshot was chosen. */
  kind: "failure" | "final";
}

/** Max characters in the executive one-liner (keeps PR previews single-line). */
const ONE_LINER_BUDGET = 160;

/**
 * Pick the hero screenshot for the evidence block.
 *
 * Rule:
 *  1. If any test failed → first failed test's failure-step screenshot.
 *  2. Else if any test passed with at least one step → first passed test's last step.
 *  3. Else → null.
 */
export function selectHero (report: E2eReport): IHero | null {
  const firstFailed = report.tests.find(
    (t): t is FailedTest => t.status === "failed",
  );
  if (firstFailed) {
    const step = firstFailed.steps.find((s) => s.stepIndex === firstFailed.failureStepIndex);
    if (step) {
      return {
        screenshotUrl: step.screenshotUrl,
        testName: firstFailed.name,
        kind: "failure",
      };
    }
  }
  const firstPassedWithSteps = report.tests.find(
    (t): t is PassedTest => t.status === "passed" && t.steps.length > 0,
  );
  if (firstPassedWithSteps) {
    const lastStep = firstPassedWithSteps.steps[firstPassedWithSteps.steps.length - 1];
    return {
      screenshotUrl: lastStep.screenshotUrl,
      testName: firstPassedWithSteps.name,
      kind: "final",
    };
  }
  return null;
}

/**
 * Build the single-sentence verdict that heads the evidence block.
 *
 * Examples:
 *  - "All 4 acceptance tests passed."
 *  - "1 of 4 failed — \"Checkout flow\" broke at step 3: Element not found."
 *  - "No acceptance tests were executed."
 */
export function buildOneLiner (report: E2eReport): string {
  const total = report.tests.length;
  if (total === 0) {
    return "No acceptance tests were executed.";
  }
  const failed = report.tests.filter((t): t is FailedTest => t.status === "failed");
  if (failed.length === 0) {
    return `All ${total} acceptance tests passed.`;
  }
  const first = failed[0];
  const prefix = `${failed.length} of ${total} failed — "${first.name}" broke at step ${first.failureStepIndex}: `;
  const available = ONE_LINER_BUDGET - prefix.length - 1; // -1 for trailing period
  const error = first.error.length > available
    ? first.error.slice(0, Math.max(0, available - 1)) + "…"
    : first.error;
  return `${prefix}${error}.`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/cli/pr-section/selectors.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli/pr-section/selectors.ts src/cli/pr-section/selectors.test.ts
git commit -m "feat(pr-section): add hero and one-liner selectors"
```

---

## Task 3: Render primitives — summary, row, details, body, comment

**Files:**
- Create: `src/cli/pr-section/render.ts`
- Create: `src/cli/pr-section/render.test.ts`

**Context:** This is the core markdown emitter. It exposes five pure functions — `renderSummary`, `renderRow`, `renderFailureDetails`, `renderBody`, `renderComment` — and one constant, `DASHBOARD_URL_BASE`. All of them take plain data and return strings. None of them do I/O, none of them know about overflow. Overflow composition lives in Task 4.

The body-and-comment combo has two modes controlled by a single boolean `inlineFailureDetails`:

- `true` (default, "fits in body"): body = summary + rows table + full `<details>` blocks for failed tests. Comment is not rendered.
- `false` ("oversized, spill to comment"): body = summary + rows table + a single pointer line. Comment = header + `<details>` blocks for failed tests.

- [ ] **Step 1: Write the failing tests**

Create `src/cli/pr-section/render.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import {
  DASHBOARD_URL_BASE,
  renderSummary,
  renderRow,
  renderFailureDetails,
  renderBody,
  renderComment,
} from "./render.js";
import type { E2eReport, FailedTest, PassedTest } from "./types.js";

const passed: PassedTest = {
  name: "Login flow",
  testCaseId: "tc-1",
  runId: "run-1",
  viewUrl: "https://www.muggle-ai.com/x/run-1",
  status: "passed",
  steps: [
    { stepIndex: 0, action: "Navigate to /login", screenshotUrl: "https://cdn/1-0.png" },
    { stepIndex: 1, action: "Click Sign In", screenshotUrl: "https://cdn/1-1.png" },
  ],
};

const failed: FailedTest = {
  name: "Checkout flow",
  testCaseId: "tc-2",
  runId: "run-2",
  viewUrl: "https://www.muggle-ai.com/x/run-2",
  status: "failed",
  failureStepIndex: 1,
  error: "Element not found",
  steps: [
    { stepIndex: 0, action: "Add item", screenshotUrl: "https://cdn/2-0.png" },
    { stepIndex: 1, action: "Click confirm", screenshotUrl: "https://cdn/2-1.png" },
  ],
};

const allPassed: E2eReport = { projectId: "p1", tests: [passed] };
const withFailure: E2eReport = { projectId: "p1", tests: [passed, failed] };

describe("renderSummary", () => {
  it("includes count, one-liner, hero, and dashboard link for all-passed", () => {
    const md = renderSummary(allPassed);
    expect(md).toContain("**1 passed / 0 failed**");
    expect(md).toContain("All 1 acceptance tests passed.");
    expect(md).toContain("https://cdn/1-1.png"); // hero = last step of first passed
    expect(md).toContain(`${DASHBOARD_URL_BASE}/p1/scripts`);
  });

  it("shows failure hero when there are failures", () => {
    const md = renderSummary(withFailure);
    expect(md).toContain("**1 passed / 1 failed**");
    expect(md).toContain('"Checkout flow" broke at step 1: Element not found.');
    expect(md).toContain("https://cdn/2-1.png"); // hero = failure step
  });

  it("omits the hero block when there are zero tests", () => {
    const md = renderSummary({ projectId: "p1", tests: [] });
    expect(md).toContain("No acceptance tests were executed.");
    expect(md).not.toContain("<img");
  });
});

describe("renderRow", () => {
  it("renders a passed row with the final-step thumbnail", () => {
    const row = renderRow(passed);
    expect(row).toContain("[Login flow](https://www.muggle-ai.com/x/run-1)");
    expect(row).toContain("✅");
    expect(row).toContain("https://cdn/1-1.png");
  });

  it("renders a failed row with the failure-step thumbnail and inline error", () => {
    const row = renderRow(failed);
    expect(row).toContain("[Checkout flow](https://www.muggle-ai.com/x/run-2)");
    expect(row).toContain("❌");
    expect(row).toContain("https://cdn/2-1.png");
    expect(row).toContain("Element not found");
  });
});

describe("renderFailureDetails", () => {
  it("renders a <details> block with every step and marks the failure step", () => {
    const md = renderFailureDetails(failed);
    expect(md).toContain("<details>");
    expect(md).toContain("Checkout flow");
    expect(md).toContain("Add item");
    expect(md).toContain("Click confirm");
    expect(md).toContain("⚠️");
    expect(md).toContain("Element not found");
    expect(md).toContain("https://cdn/2-0.png");
    expect(md).toContain("https://cdn/2-1.png");
  });
});

describe("renderBody", () => {
  it("renders body with inline failure details when inlineFailureDetails=true", () => {
    const body = renderBody(withFailure, { inlineFailureDetails: true });
    expect(body).toContain("## E2E Acceptance Results");
    expect(body).toContain("| Test Case |");
    expect(body).toContain("<details>");
    expect(body).not.toContain("Full step-by-step evidence in the comment");
  });

  it("renders body with pointer line when inlineFailureDetails=false", () => {
    const body = renderBody(withFailure, { inlineFailureDetails: false });
    expect(body).toContain("## E2E Acceptance Results");
    expect(body).toContain("| Test Case |");
    expect(body).not.toContain("<details>");
    expect(body).toContain("Full step-by-step evidence in the comment below");
  });

  it("all-passed body has no failure details and no pointer line in either mode", () => {
    const inline = renderBody(allPassed, { inlineFailureDetails: true });
    const spilled = renderBody(allPassed, { inlineFailureDetails: false });
    expect(inline).not.toContain("<details>");
    expect(spilled).not.toContain("<details>");
    expect(spilled).not.toContain("Full step-by-step evidence");
  });
});

describe("renderComment", () => {
  it("renders a comment with one <details> block per failed test", () => {
    const comment = renderComment(withFailure);
    expect(comment).toContain("## E2E acceptance evidence (overflow)");
    expect(comment).toContain("<details>");
    expect(comment).toContain("Checkout flow");
  });

  it("returns empty string when there are no failures", () => {
    expect(renderComment(allPassed)).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/cli/pr-section/render.test.ts`
Expected: FAIL — `Cannot find module './render.js'`.

- [ ] **Step 3: Implement the renderer**

Create `src/cli/pr-section/render.ts`:

```ts
/**
 * Pure markdown emitters for the PR body evidence block and the overflow comment.
 * No I/O, no length measurement, no overflow logic — see overflow.ts for that.
 */

import { buildOneLiner, selectHero } from "./selectors.js";
import type { E2eReport, FailedTest, TestResult, Step } from "./types.js";

export const DASHBOARD_URL_BASE =
  "https://www.muggle-ai.com/muggleTestV0/dashboard/projects";

/** Width of thumbnails in the per-test compact rows. */
const ROW_THUMB_WIDTH = 120;
/** Width of thumbnails in the collapsible failure-details blocks. */
const DETAIL_THUMB_WIDTH = 200;
/** Width of the hero image in the summary block. */
const HERO_WIDTH = 480;

/** Build a clickable thumbnail image: links to full size, displays at width. */
function thumbnail (url: string, width: number): string {
  return `<a href="${url}"><img src="${url}" width="${width}"></a>`;
}

/** Compact counts string, e.g. "3 passed / 1 failed". */
function counts (report: E2eReport): { passed: number; failed: number; text: string } {
  const passed = report.tests.filter((t) => t.status === "passed").length;
  const failed = report.tests.filter((t) => t.status === "failed").length;
  return { passed, failed, text: `**${passed} passed / ${failed} failed**` };
}

/**
 * Render the top summary block: counts, one-liner, hero screenshot, dashboard link.
 */
export function renderSummary (report: E2eReport): string {
  const { text: countsLine } = counts(report);
  const oneLiner = buildOneLiner(report);
  const hero = selectHero(report);
  const dashboard = `${DASHBOARD_URL_BASE}/${report.projectId}/scripts`;
  const lines: string[] = [
    countsLine,
    "",
    oneLiner,
    "",
  ];
  if (hero) {
    lines.push(
      `<a href="${hero.screenshotUrl}"><img src="${hero.screenshotUrl}" width="${HERO_WIDTH}" alt="${hero.testName}"></a>`,
      "",
    );
  }
  lines.push(`[View project dashboard on muggle-ai.com](${dashboard})`);
  return lines.join("\n");
}

/**
 * Render one compact row for a test case. Caller is responsible for wrapping rows
 * in a markdown table header.
 */
export function renderRow (test: TestResult): string {
  const link = `[${test.name}](${test.viewUrl})`;
  if (test.status === "passed") {
    const lastStep = test.steps[test.steps.length - 1];
    const thumb = lastStep ? thumbnail(lastStep.screenshotUrl, ROW_THUMB_WIDTH) : "—";
    return `| ${link} | ✅ PASSED | ${thumb} |`;
  }
  const failStep = test.steps.find((s) => s.stepIndex === test.failureStepIndex);
  const thumb = failStep ? thumbnail(failStep.screenshotUrl, ROW_THUMB_WIDTH) : "—";
  return `| ${link} | ❌ FAILED — ${test.error} | ${thumb} |`;
}

/** Render one collapsible `<details>` block for a failed test. */
export function renderFailureDetails (test: FailedTest): string {
  const stepCount = test.steps.length;
  const header = `<details>\n<summary>📸 <strong>${test.name}</strong> — ${stepCount} steps (failed at step ${test.failureStepIndex})</summary>\n\n| # | Action | Screenshot |\n|---|--------|------------|`;
  const rows = test.steps.map((step) => renderFailureStepRow(step, test)).join("\n");
  return `${header}\n${rows}\n\n</details>`;
}

function renderFailureStepRow (step: Step, test: FailedTest): string {
  const isFailure = step.stepIndex === test.failureStepIndex;
  const marker = isFailure ? `${step.stepIndex} ⚠️` : String(step.stepIndex);
  const action = isFailure
    ? `${step.action} — **${test.error}**`
    : step.action;
  return `| ${marker} | ${action} | ${thumbnail(step.screenshotUrl, DETAIL_THUMB_WIDTH)} |`;
}

/** Render the compact per-test table (always goes in the body). */
function renderRowsTable (report: E2eReport): string {
  if (report.tests.length === 0) {
    return "_No tests were executed._";
  }
  const header = "| Test Case | Status | Evidence |\n|-----------|--------|----------|";
  const rows = report.tests.map(renderRow).join("\n");
  return `${header}\n${rows}`;
}

/** Options for renderBody. */
export interface IRenderBodyOptions {
  /**
   * When true, collapsible `<details>` blocks for failed tests are included inline in the body.
   * When false, a single pointer line is written instead and the details are expected to be
   * posted as an overflow comment by the caller.
   */
  inlineFailureDetails: boolean;
}

/** Render the full PR-body evidence block (top summary + rows + optional details). */
export function renderBody (report: E2eReport, opts: IRenderBodyOptions): string {
  const sections: string[] = [
    "## E2E Acceptance Results",
    "",
    renderSummary(report),
    "",
    renderRowsTable(report),
  ];
  const failures = report.tests.filter((t): t is FailedTest => t.status === "failed");
  if (failures.length > 0) {
    if (opts.inlineFailureDetails) {
      sections.push("", ...failures.map(renderFailureDetails));
    } else {
      sections.push(
        "",
        "_Full step-by-step evidence in the comment below — the PR description was too large to inline it._",
      );
    }
  }
  return sections.join("\n");
}

/** Render the overflow comment body. Returns empty string if there are no failures to show. */
export function renderComment (report: E2eReport): string {
  const failures = report.tests.filter((t): t is FailedTest => t.status === "failed");
  if (failures.length === 0) {
    return "";
  }
  const sections: string[] = [
    "## E2E acceptance evidence (overflow)",
    "",
    "_This comment was posted because the full step-by-step evidence did not fit in the PR description._",
    "",
    ...failures.map(renderFailureDetails),
  ];
  return sections.join("\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/cli/pr-section/render.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli/pr-section/render.ts src/cli/pr-section/render.test.ts
git commit -m "feat(pr-section): add markdown renderer for body and overflow comment"
```

---

## Task 4: Overflow split

**Files:**
- Create: `src/cli/pr-section/overflow.ts`
- Create: `src/cli/pr-section/overflow.test.ts`
- Create: `src/cli/pr-section/fixtures/oversized.json`

**Context:** This task implements the all-or-nothing overflow rule. Given a report and a byte budget, it returns the final `{body, comment}` pair. The algorithm:

1. Try `renderBody(report, { inlineFailureDetails: true })`.
2. If the UTF-8 byte length is within the budget, return `{ body: inline, comment: null }`.
3. Otherwise, return `{ body: renderBody(report, { inlineFailureDetails: false }), comment: renderComment(report) }`.

The byte budget is a parameter — no defaults here. Defaults live at the CLI boundary.

- [ ] **Step 1: Create the oversized fixture**

Create `src/cli/pr-section/fixtures/oversized.json`:

```json
{
  "projectId": "5365f324-5c5f-4adf-b702-11f457b29b04",
  "tests": [
    {
      "name": "Giant failed flow 1",
      "testCaseId": "tc-1",
      "runId": "run-1",
      "viewUrl": "https://www.muggle-ai.com/x/run-1",
      "status": "failed",
      "failureStepIndex": 19,
      "error": "Element not found",
      "steps": [
        { "stepIndex": 0, "action": "Step 0 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000000.png" },
        { "stepIndex": 1, "action": "Step 1 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000001.png" },
        { "stepIndex": 2, "action": "Step 2 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000002.png" },
        { "stepIndex": 3, "action": "Step 3 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000003.png" },
        { "stepIndex": 4, "action": "Step 4 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000004.png" },
        { "stepIndex": 5, "action": "Step 5 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000005.png" },
        { "stepIndex": 6, "action": "Step 6 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000006.png" },
        { "stepIndex": 7, "action": "Step 7 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000007.png" },
        { "stepIndex": 8, "action": "Step 8 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000008.png" },
        { "stepIndex": 9, "action": "Step 9 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000009.png" },
        { "stepIndex": 10, "action": "Step 10 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000010.png" },
        { "stepIndex": 11, "action": "Step 11 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000011.png" },
        { "stepIndex": 12, "action": "Step 12 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000012.png" },
        { "stepIndex": 13, "action": "Step 13 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000013.png" },
        { "stepIndex": 14, "action": "Step 14 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000014.png" },
        { "stepIndex": 15, "action": "Step 15 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000015.png" },
        { "stepIndex": 16, "action": "Step 16 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000016.png" },
        { "stepIndex": 17, "action": "Step 17 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000017.png" },
        { "stepIndex": 18, "action": "Step 18 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000018.png" },
        { "stepIndex": 19, "action": "Step 19 with a long enough action description to take space", "screenshotUrl": "https://cdn.muggle.ai/run-1/000000019.png" }
      ]
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/cli/pr-section/overflow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { splitWithOverflow } from "./overflow.js";
import { E2eReportSchema } from "./types.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
function load(name: string) {
  return E2eReportSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8")),
  );
}

describe("splitWithOverflow", () => {
  it("keeps everything in the body when it fits", () => {
    const report = load("one-failed.json");
    const result = splitWithOverflow(report, { maxBodyBytes: 60_000 });
    expect(result.comment).toBeNull();
    expect(result.body).toContain("<details>");
    expect(Buffer.byteLength(result.body, "utf-8")).toBeLessThanOrEqual(60_000);
  });

  it("spills failure details into the comment when the inline body exceeds the budget", () => {
    const report = load("oversized.json");
    const result = splitWithOverflow(report, { maxBodyBytes: 1500 });
    expect(result.comment).not.toBeNull();
    expect(result.body).not.toContain("<details>");
    expect(result.body).toContain("Full step-by-step evidence in the comment below");
    expect(result.comment).toContain("<details>");
  });

  it("never spills when there are no failures (all-passed report)", () => {
    const report = load("all-passed.json");
    const result = splitWithOverflow(report, { maxBodyBytes: 100 }); // absurdly small budget
    // All-passed reports have no failure details to spill, so comment stays null
    // even if the body exceeds the budget. Downstream handling is the caller's job.
    expect(result.comment).toBeNull();
  });

  it("uses utf-8 byte length, not character length", () => {
    const report = load("one-failed.json");
    // Inline body is well under 60k bytes.
    const fitting = splitWithOverflow(report, { maxBodyBytes: 60_000 });
    expect(fitting.comment).toBeNull();
    // Force overflow with a tiny budget.
    const spilling = splitWithOverflow(report, { maxBodyBytes: 500 });
    expect(spilling.comment).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/cli/pr-section/overflow.test.ts`
Expected: FAIL — `Cannot find module './overflow.js'`.

- [ ] **Step 4: Implement the overflow split**

Create `src/cli/pr-section/overflow.ts`:

```ts
/**
 * All-or-nothing overflow split for the PR body evidence block.
 *
 * If the full inline body fits within the byte budget, return it as-is with no comment.
 * Otherwise, move the collapsible failure-details tier into a follow-up comment and
 * replace them in the body with a single pointer line.
 *
 * "Budget" is UTF-8 byte length, not character length: GitHub's PR body limit is
 * byte-based, and markdown can contain multibyte characters.
 */

import { renderBody, renderComment } from "./render.js";
import type { E2eReport } from "./types.js";

export interface ISplitOptions {
  /** Maximum UTF-8 byte length of the rendered body. */
  maxBodyBytes: number;
}

export interface ISplitResult {
  /** Markdown to paste into the PR description. */
  body: string;
  /** Markdown to post as a follow-up comment, or null if no overflow happened. */
  comment: string | null;
}

/**
 * Decide whether the evidence block fits in the PR body, and return the right split.
 */
export function splitWithOverflow (
  report: E2eReport,
  opts: ISplitOptions,
): ISplitResult {
  const inlineBody = renderBody(report, { inlineFailureDetails: true });
  const inlineBytes = Buffer.byteLength(inlineBody, "utf-8");
  if (inlineBytes <= opts.maxBodyBytes) {
    return { body: inlineBody, comment: null };
  }
  const spilledBody = renderBody(report, { inlineFailureDetails: false });
  const comment = renderComment(report);
  return {
    body: spilledBody,
    comment: comment.length > 0 ? comment : null,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/cli/pr-section/overflow.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/cli/pr-section/overflow.ts src/cli/pr-section/overflow.test.ts \
  src/cli/pr-section/fixtures/oversized.json
git commit -m "feat(pr-section): add overflow split for oversized PR bodies"
```

---

## Task 5: Top-level `buildPrSection` API + barrel export

**Files:**
- Create: `src/cli/pr-section/index.ts`
- Create: `src/cli/pr-section/index.test.ts`

**Context:** A thin barrel that exposes the one call consumers actually make: `buildPrSection(report, opts) → { body, comment }`. All it does is forward to `splitWithOverflow` and re-export types. This is the import surface for both the CLI handler (Task 6) and any future in-process caller.

- [ ] **Step 1: Write the failing test**

Create `src/cli/pr-section/index.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { buildPrSection, E2eReportSchema } from "./index.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
function load(name: string) {
  return E2eReportSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8")),
  );
}

describe("buildPrSection", () => {
  it("returns body and null comment for a report that fits the budget", () => {
    const result = buildPrSection(load("one-failed.json"), { maxBodyBytes: 60_000 });
    expect(result.body).toContain("## E2E Acceptance Results");
    expect(result.comment).toBeNull();
  });

  it("returns body and comment for a report that exceeds the budget", () => {
    const result = buildPrSection(load("oversized.json"), { maxBodyBytes: 1500 });
    expect(result.body).toContain("Full step-by-step evidence in the comment below");
    expect(result.comment).toContain("## E2E acceptance evidence (overflow)");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/cli/pr-section/index.test.ts`
Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 3: Implement the barrel**

Create `src/cli/pr-section/index.ts`:

```ts
/**
 * Public API for the PR-body evidence block builder.
 *
 * `buildPrSection(report, opts)` is the single entry point for both the
 * `muggle build-pr-section` CLI handler and any in-process caller.
 */

import { splitWithOverflow, type ISplitOptions, type ISplitResult } from "./overflow.js";
import type { E2eReport } from "./types.js";

export { E2eReportSchema } from "./types.js";
export type { E2eReport, TestResult, PassedTest, FailedTest, Step } from "./types.js";
export type { ISplitOptions, ISplitResult } from "./overflow.js";

/**
 * Render a PR-body evidence block and (optionally) an overflow comment from an
 * e2e-acceptance report.
 */
export function buildPrSection (report: E2eReport, opts: ISplitOptions): ISplitResult {
  return splitWithOverflow(report, opts);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/cli/pr-section/index.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli/pr-section/index.ts src/cli/pr-section/index.test.ts
git commit -m "feat(pr-section): add buildPrSection barrel export"
```

---

## Task 6: CLI handler `build-pr-section`

**Files:**
- Create: `src/cli/build-pr-section.ts`
- Create: `src/cli/build-pr-section.test.ts`

**Context:** A Commander action that reads stdin to EOF, parses the JSON as an `E2eReport` (bubbling Zod errors with a clear message + nonzero exit), calls `buildPrSection`, and writes `{body, comment}` JSON to stdout. Options: `--max-body-bytes <n>` (default `60000`).

The handler must be **pure of side effects beyond stdin/stdout + process.exitCode**: no network, no filesystem, no logging to stdout (logs go to stderr). This keeps it composable in the `open-prs.md` pipeline.

- [ ] **Step 1: Write the failing test**

Create `src/cli/build-pr-section.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "stream";

import { runBuildPrSection } from "./build-pr-section.js";

function makeStdin(json: unknown): NodeJS.ReadableStream {
  return Readable.from([JSON.stringify(json)]);
}

describe("runBuildPrSection", () => {
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let stdoutWrite: (s: string) => boolean;
  let stderrWrite: (s: string) => boolean;

  beforeEach(() => {
    stdoutChunks = [];
    stderrChunks = [];
    stdoutWrite = (s: string) => {
      stdoutChunks.push(s);
      return true;
    };
    stderrWrite = (s: string) => {
      stderrChunks.push(s);
      return true;
    };
  });

  it("writes JSON {body, comment} to stdout for a valid report", async () => {
    const report = {
      projectId: "p1",
      tests: [
        {
          name: "A",
          testCaseId: "a",
          runId: "ra",
          viewUrl: "https://example.com/a",
          status: "passed",
          steps: [
            { stepIndex: 0, action: "Click", screenshotUrl: "https://cdn/a0.png" },
          ],
        },
      ],
    };
    const exitCode = await runBuildPrSection({
      stdin: makeStdin(report),
      stdoutWrite,
      stderrWrite,
      maxBodyBytes: 60_000,
    });
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdoutChunks.join(""));
    expect(out.body).toContain("## E2E Acceptance Results");
    expect(out.comment).toBeNull();
  });

  it("exits nonzero with a clear error on invalid JSON", async () => {
    const stdin = Readable.from(["not json"]);
    const exitCode = await runBuildPrSection({
      stdin,
      stdoutWrite,
      stderrWrite,
      maxBodyBytes: 60_000,
    });
    expect(exitCode).toBe(1);
    expect(stderrChunks.join("")).toMatch(/failed to parse/i);
    expect(stdoutChunks.join("")).toBe("");
  });

  it("exits nonzero with Zod validation errors", async () => {
    const exitCode = await runBuildPrSection({
      stdin: makeStdin({ projectId: "", tests: [] }),
      stdoutWrite,
      stderrWrite,
      maxBodyBytes: 60_000,
    });
    expect(exitCode).toBe(1);
    expect(stderrChunks.join("")).toMatch(/validation/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/cli/build-pr-section.test.ts`
Expected: FAIL — `Cannot find module './build-pr-section.js'`.

- [ ] **Step 3: Implement the handler**

Create `src/cli/build-pr-section.ts`:

```ts
/**
 * `muggle build-pr-section` CLI handler.
 *
 * Reads an e2e-acceptance report JSON from stdin, renders the PR body evidence
 * block (and optionally an overflow comment), and writes `{body, comment}` JSON
 * to stdout. All logging goes to stderr so stdout is machine-parseable.
 */

import { ZodError } from "zod";

import { buildPrSection, E2eReportSchema } from "./pr-section/index.js";

/** Default UTF-8 byte budget for the PR description. */
export const DEFAULT_MAX_BODY_BYTES = 60_000;

interface IRunOptions {
  stdin: NodeJS.ReadableStream;
  stdoutWrite: (s: string) => boolean;
  stderrWrite: (s: string) => boolean;
  maxBodyBytes: number;
}

async function readAll (stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Pure-ish entry point used by the Commander action and by tests.
 * Returns the desired process exit code instead of calling process.exit itself.
 */
export async function runBuildPrSection (opts: IRunOptions): Promise<number> {
  let raw: string;
  try {
    raw = await readAll(opts.stdin);
  } catch (err) {
    opts.stderrWrite(`build-pr-section: failed to read stdin: ${errMsg(err)}\n`);
    return 1;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    opts.stderrWrite(`build-pr-section: failed to parse stdin as JSON: ${errMsg(err)}\n`);
    return 1;
  }
  let report;
  try {
    report = E2eReportSchema.parse(json);
  } catch (err) {
    if (err instanceof ZodError) {
      opts.stderrWrite(`build-pr-section: report validation failed:\n${err.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}\n`);
    } else {
      opts.stderrWrite(`build-pr-section: report validation failed: ${errMsg(err)}\n`);
    }
    return 1;
  }
  const result = buildPrSection(report, { maxBodyBytes: opts.maxBodyBytes });
  opts.stdoutWrite(JSON.stringify({ body: result.body, comment: result.comment }));
  return 0;
}

function errMsg (e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Commander action. */
export async function buildPrSectionCommand (options: { maxBodyBytes?: string }): Promise<void> {
  const maxBodyBytes = options.maxBodyBytes ? Number(options.maxBodyBytes) : DEFAULT_MAX_BODY_BYTES;
  if (!Number.isFinite(maxBodyBytes) || maxBodyBytes <= 0) {
    process.stderr.write(`build-pr-section: --max-body-bytes must be a positive number\n`);
    process.exitCode = 1;
    return;
  }
  const code = await runBuildPrSection({
    stdin: process.stdin,
    stdoutWrite: (s) => process.stdout.write(s),
    stderrWrite: (s) => process.stderr.write(s),
    maxBodyBytes,
  });
  if (code !== 0) {
    process.exitCode = code;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/cli/build-pr-section.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli/build-pr-section.ts src/cli/build-pr-section.test.ts
git commit -m "feat(cli): add build-pr-section handler"
```

---

## Task 7: Wire the handler into the commands package

**Files:**
- Modify: `packages/commands/src/handlers/index.ts`
- Modify: `packages/commands/src/cli/run-cli.ts`

**Context:** Re-export `buildPrSectionCommand` from the commands package surface and register `muggle build-pr-section` with Commander. Matches the existing pattern for `cleanup`, `doctor`, etc.

- [ ] **Step 1: Add the re-export**

Edit `packages/commands/src/handlers/index.ts` — append:

```ts
export { buildPrSectionCommand } from "../../../../src/cli/build-pr-section.js";
```

- [ ] **Step 2: Register the subcommand**

Edit `packages/commands/src/cli/run-cli.ts`:

In the imports block, add `buildPrSectionCommand` to the list from `"../handlers/index.js"`:

```ts
import {
  buildPrSectionCommand,
  cleanupCommand,
  doctorCommand,
  helpCommand,
  loginCommand,
  logoutCommand,
  serveCommand,
  setupCommand,
  statusCommand,
  upgradeCommand,
  versionsCommand,
} from "../handlers/index.js";
```

In `createProgram()`, just before the `program.action(() => { helpCommand(); });` catch-all, add:

```ts
  program
    .command("build-pr-section")
    .description("Render a muggle-do PR body evidence block from an e2e report on stdin")
    .option("--max-body-bytes <n>", "Max UTF-8 byte budget for the PR body (default 60000)")
    .action(buildPrSectionCommand);
```

- [ ] **Step 3: Type-check and run existing tests**

Run: `pnpm typecheck && pnpm test`
Expected: all type checks pass, all tests pass (including the new ones from tasks 1–6).

- [ ] **Step 4: Smoke-test the subcommand registration**

Run: `pnpm build && node dist/cli.js build-pr-section --help`
Expected: Commander prints help for the subcommand including the `--max-body-bytes` option. No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/commands/src/handlers/index.ts packages/commands/src/cli/run-cli.ts
git commit -m "feat(cli): register muggle build-pr-section subcommand"
```

---

## Task 8: Update the `open-prs.md` skill

**Files:**
- Modify: `plugin/skills/do/open-prs.md`

**Context:** The skill is what `muggle-do` agents actually read. It tells them how to build the PR body and whether to post the follow-up comment. After this edit, the skill calls the CLI instead of describing the markdown template inline, and the comment is conditional on the CLI's output.

The skill currently has two large sections to replace:
1. "E2E acceptance results section format (PR body)" — the hand-written markdown template.
2. "E2E acceptance evidence comment format" — the always-posted comment.

- [ ] **Step 1: Read the current file to confirm section boundaries**

Read: `plugin/skills/do/open-prs.md` (full file).
Confirm the sections exist at the line ranges you expect before editing.

- [ ] **Step 2: Replace the results-format and comment-format sections**

Replace everything from the `## E2E acceptance results section format (PR body)` header down through the end of the `## E2E acceptance evidence comment format` section (including its subsection "Comment Building Rules") with:

```markdown
## Rendering the E2E acceptance results block

Do **not** hand-write the `## E2E Acceptance Results` markdown. Use the `muggle build-pr-section` CLI, which renders a deterministic block and decides whether the evidence fits in the PR description or needs to spill into an overflow comment.

### Step A: Build the report JSON

Assemble the e2e-acceptance report you collected in `e2e-acceptance.md` into a JSON object with this shape:

```json
{
  "projectId": "<project UUID>",
  "tests": [
    {
      "name": "<test case name>",
      "testCaseId": "<UUID>",
      "testScriptId": "<UUID or omitted>",
      "runId": "<UUID>",
      "viewUrl": "<muggle-ai.com run URL>",
      "status": "passed" | "failed",
      "steps": [
        { "stepIndex": 0, "action": "<action>", "screenshotUrl": "<URL>" }
      ],
      "failureStepIndex": 2,         // required if status=failed
      "error": "<error message>",    // required if status=failed
      "artifactsDir": "<path>"       // optional, if status=failed
    }
  ]
}
```

### Step B: Render the evidence block

Pipe the JSON into `muggle build-pr-section`. It writes `{ "body": "...", "comment": "..." | null }` to stdout:

```bash
echo "$REPORT_JSON" | muggle build-pr-section > /tmp/muggle-pr-section.json
```

The command exits nonzero on malformed input and writes a descriptive error to stderr — do not swallow that error, surface it to the user.

### Step C: Build the PR body

Build the PR body by concatenating, in order:

- `## Goal` — the requirements goal
- `## Acceptance Criteria` — bulleted list (omit section if empty)
- `## Changes` — summary of what changed in this repo
- The `body` field from the CLI output (already contains its own `## E2E Acceptance Results` header)

### Step D: Create the PR, then post the overflow comment only if present

1. Create the PR with `gh pr create --title "..." --body "..." --head <branch>`.
2. Capture the PR URL and extract the PR number.
3. If the CLI output's `comment` field is `null`, **do not post a comment** — everything is already in the PR description.
4. If the CLI output's `comment` field is a non-null string, post it as a follow-up comment:

   ```bash
   gh pr comment <PR#> --body "$(cat <<'EOF'
   <comment field contents>
   EOF
   )"
   ```

### Notes on fit vs. overflow

- **The common case is fit**: the full evidence (summary, per-test rows, collapsible failure details) lives in the PR description, no comment is posted.
- **The overflow case** is triggered automatically when the full inline body would exceed the CLI's budget. In that case the PR description contains the summary, the per-test rows, and a pointer line; the full step-by-step failure details live in the follow-up comment.
- You do not make the fit-vs-overflow decision — the CLI does. Never post the comment speculatively.
```

Also update the bulleted list under "Build the PR body" earlier in the file (step 3 of "Your Job") to reference the CLI instead of a hand-written section:

Replace the current:

```markdown
3. **Build the PR body** with these sections:
   - `## Goal` — the requirements goal
   - `## Acceptance Criteria` — bulleted list (omit section if empty)
   - `## Changes` — summary of what changed in this repo
   - `## E2E Acceptance Results` — summary table (see format below)
```

with:

```markdown
3. **Build the PR body** with these sections:
   - `## Goal` — the requirements goal
   - `## Acceptance Criteria` — bulleted list (omit section if empty)
   - `## Changes` — summary of what changed in this repo
   - E2E acceptance evidence block from `muggle build-pr-section` (see "Rendering the E2E acceptance results block" below)
```

And update step 6 in "Your Job":

Replace:

```markdown
6. **Post E2E acceptance evidence comment** with screenshots (see format below).
```

with:

```markdown
6. **Post the overflow comment only if `muggle build-pr-section` emitted one** (see "Rendering the E2E acceptance results block" below). In the common case, no comment is posted.
```

And update the "Output" section at the bottom:

Replace:

```markdown
**E2E acceptance evidence comments posted:**
- (repo name): comment posted to PR #(number)
```

with:

```markdown
**E2E acceptance overflow comments posted:** (only include repos where an overflow comment was actually posted)
- (repo name): comment posted to PR #(number)
```

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/do/open-prs.md
git commit -m "docs(skill): use muggle build-pr-section for PR body evidence"
```

---

## Task 9: End-to-end smoke test

**Files:** None created. This is a manual verification step with concrete commands.

**Context:** Run the CLI against all three fixtures, inspect the output, and verify it matches expectations. No assertion framework here — this is the "actually run it" gate before handing back.

- [ ] **Step 1: Rebuild the CLI from sources**

Run: `pnpm build`
Expected: `dist/cli.js` exists and is newer than the source files.

- [ ] **Step 2: Run against the all-passed fixture**

Run:

```bash
cat src/cli/pr-section/fixtures/all-passed.json \
  | node dist/cli.js build-pr-section \
  | node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log("comment:", d.comment); console.log("body bytes:", Buffer.byteLength(d.body, "utf8")); console.log("--- BODY ---"); console.log(d.body);'
```

Expected:
- `comment: null`
- `body bytes` well under 60000
- Body contains `## E2E Acceptance Results`, `**3 passed / 0 failed**`, `All 3 acceptance tests passed.`, a hero `<img>`, a dashboard link to `https://www.muggle-ai.com/muggleTestV0/dashboard/projects/5365f324-5c5f-4adf-b702-11f457b29b04/scripts`, and three table rows with thumbnails. No `<details>` blocks.

- [ ] **Step 3: Run against the one-failed fixture**

Run:

```bash
cat src/cli/pr-section/fixtures/one-failed.json \
  | node dist/cli.js build-pr-section \
  | node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log("comment:", d.comment === null ? "null" : "(present)"); console.log("body bytes:", Buffer.byteLength(d.body, "utf8")); console.log("--- BODY ---"); console.log(d.body);'
```

Expected:
- `comment: null` (fits)
- Body contains `**2 passed / 1 failed**`, `"Checkout flow" broke at step 2: Element not found.`, the failure-step hero image, three table rows (two ✅, one ❌), and exactly one `<details>` block for Checkout flow with the failure step marked `⚠️`.

- [ ] **Step 4: Force overflow with the oversized fixture**

Run:

```bash
cat src/cli/pr-section/fixtures/oversized.json \
  | node dist/cli.js build-pr-section --max-body-bytes 1500 \
  | node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log("comment present:", d.comment !== null); console.log("body contains details:", d.body.includes("<details>")); console.log("comment contains details:", d.comment && d.comment.includes("<details>")); console.log("body bytes:", Buffer.byteLength(d.body, "utf8"));'
```

Expected:
- `comment present: true`
- `body contains details: false`
- `comment contains details: true`
- `body bytes` ≤ 1500 plus the small fixed-overhead of the summary + rows (the rule is "inline body exceeded budget, so we spilled"; the spilled body is not itself re-checked against the budget).

- [ ] **Step 5: Malformed input**

Run:

```bash
echo 'not json' | node dist/cli.js build-pr-section; echo "exit=$?"
```

Expected: stderr contains `failed to parse stdin as JSON`, stdout is empty, `exit=1`.

Run:

```bash
echo '{"projectId": "", "tests": []}' | node dist/cli.js build-pr-section; echo "exit=$?"
```

Expected: stderr contains `report validation failed`, stdout is empty, `exit=1`.

- [ ] **Step 6: Lint, typecheck, and full test pass**

Run: `pnpm lint:check && pnpm typecheck && pnpm test`
Expected: clean across the board.

- [ ] **Step 7: Commit any small fixups**

If the smoke tests surface any issues, fix them in code (not in this plan) and commit a small fix. If everything passed, there is nothing to commit in this task.

---

## Done criteria

- `muggle build-pr-section` subcommand exists, takes stdin JSON, writes `{body, comment}` JSON to stdout, and returns nonzero with a clear stderr message on malformed input.
- All five new source files under `src/cli/pr-section/` have sibling `*.test.ts` files and all tests pass.
- The three JSON fixtures exercise the fit path, the one-failure path, and the overflow path.
- `plugin/skills/do/open-prs.md` no longer contains hand-written E2E results markdown and no longer posts the evidence comment unconditionally.
- `pnpm lint:check && pnpm typecheck && pnpm test` is green.
- Manual end-to-end smoke test against all three fixtures behaves as documented in Task 9.

---

## Out of scope (explicit)

- Re-rendering evidence on PR update / re-run. No idempotency markers.
- Truncating individual steps within a failed test. Overflow is all-or-nothing at the "inline collapsible details" tier.
- Any changes to `e2e-acceptance.md` or the shape of the report it produces.
- Making the block position, format, or budget configurable per repo or project.
- Changing the format of the overflow comment beyond what Task 3 renders.
