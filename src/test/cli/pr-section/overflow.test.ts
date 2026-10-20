import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { splitWithOverflow } from "../../../cli/pr-section/overflow.js";
import { E2eReportSchema } from "../../../cli/pr-section/types.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
function load(name: string) {
  return E2eReportSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8")),
  );
}

describe("splitWithOverflow", () => {
  it("keeps everything in the body when it fits the budget", () => {
    const report = load("one-failed.json");
    const result = splitWithOverflow(report, { maxBodyBytes: 60_000 });
    expect(result.comment).toBeNull();
    expect(result.body).toContain("<details>");
    expect(Buffer.byteLength(result.body, "utf-8")).toBeLessThanOrEqual(60_000);
  });

  it("spills per-test details into a comment when the inline body exceeds the budget", () => {
    const report = load("oversized.json");
    const result = splitWithOverflow(report, { maxBodyBytes: 300 });
    expect(result.comment).not.toBeNull();
    expect(result.body).not.toContain("<kbd>Show");
    expect(result.body).toContain("Full per-test details in the comment below");
    expect(result.comment).toContain("<details>");
    expect(result.comment).toContain("## E2E acceptance evidence (overflow)");
  });

  it("spills details for an all-passed report when it exceeds the budget", () => {
    const report = load("all-passed.json");
    const result = splitWithOverflow(report, { maxBodyBytes: 400 });
    // Every test now gets a <details> block, so all-passed reports can overflow too.
    expect(result.comment).not.toBeNull();
    expect(result.body).not.toContain("<kbd>Show");
    expect(result.body).toContain("Full per-test details in the comment below");
    expect(result.comment).toContain("<details>");
  });

  it("returns body with null comment when an empty report exceeds the budget", () => {
    const empty = E2eReportSchema.parse({ projectId: "p1", tests: [] });
    const result = splitWithOverflow(empty, { maxBodyBytes: 10 });
    // Nothing to spill for an empty report.
    expect(result.comment).toBeNull();
    expect(result.body).toContain("_No tests were executed._");
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

  it("handles a grouped mixed report end-to-end (body + overflow comment)", () => {
    const report = load("grouped-by-use-case.json");
    const fit = splitWithOverflow(report, { maxBodyBytes: 60_000 });
    expect(fit.comment).toBeNull();
    expect(fit.body).toContain("<summary><b>Create a New Project</b>");
    expect(fit.body).toContain("- ✅ **1.** User creates a new project with valid URL");
    expect(fit.body).toContain("- ❌ **2.** User receives error for invalid URL format");
    expect(fit.body).toContain("- ✅ **3.** Login with valid credentials");

    const spilled = splitWithOverflow(report, { maxBodyBytes: 500 });
    expect(spilled.comment).not.toBeNull();
    expect(spilled.body).toContain("<summary><b>Create a New Project</b>");
    expect(spilled.body).not.toContain("<kbd>Show");
  });
});

describe("overflow comment size cap", () => {
  // GitHub rejects a comment over its cap outright, so the details must shed screenshots rather than vanish.
  const _bigReport = (stepsPerTest: number, testCount = 5) => {
    const longUrl = (label: string) => `https://firebasestorage.googleapis.com/v0/b/bucket/o/${label}-${"x".repeat(300)}.jpg`;
    return E2eReportSchema.parse({
      projectId: "p1",
      tests: Array.from({ length: testCount }, (_unused, testIndex) => ({
        name: `Test ${testIndex}`,
        testCaseId: `tc-${testIndex}`,
        runId: `r-${testIndex}`,
        viewUrl: "https://example.com/run",
        status: "passed",
        steps: Array.from({ length: stepsPerTest }, (_step, stepIndex) => ({
          stepIndex: stepIndex,
          action: "click",
          description: `Click item ${stepIndex}`,
          screenshotUrl: longUrl(`t${testIndex}-s${stepIndex}-before`),
          afterScreenshotUrl: longUrl(`t${testIndex}-s${stepIndex}-after`),
        })),
      })),
    });
  };

  it("drops after screenshots when before-and-after would exceed the cap", () => {
    const result = splitWithOverflow(_bigReport(14), { maxBodyBytes: 1_000 });
    expect(Buffer.byteLength(result.comment!, "utf-8")).toBeLessThanOrEqual(64_000);
    expect(result.comment).not.toContain("| Before | After |");
    expect(result.comment).toContain("<summary>📷 1 · Click item 0</summary>");
    expect(result.comment).toContain("Step screenshots are trimmed to fit GitHub's comment size limit");
  });

  it("falls back to step text when even one screenshot per step would exceed the cap", () => {
    const result = splitWithOverflow(_bigReport(20, 10), { maxBodyBytes: 1_000 });
    expect(Buffer.byteLength(result.comment!, "utf-8")).toBeLessThanOrEqual(64_000);
    expect(result.comment).not.toContain("<summary>📷");
    expect(result.comment).toContain("- 1 · Click item 0");
  });

  it("keeps both screenshots when they fit", () => {
    const result = splitWithOverflow(_bigReport(2), { maxBodyBytes: 1_000 });
    expect(result.comment).toContain("| Before | After |");
    expect(result.comment).not.toContain("trimmed to fit");
  });
});
