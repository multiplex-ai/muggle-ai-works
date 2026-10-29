import { describe, it, expect, beforeEach, vi } from "vitest";
import { Readable } from "stream";

import { runBuildPrSection } from "../../cli/build-pr-section.js";

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

  it("renders the failures baseline verification credits, never a failsOnBase the input carried", async () => {
    const failedTest = {
      name: "Checkout",
      testCaseId: "tc-2",
      runId: "pr-run",
      viewUrl: "https://example.com/pr",
      status: "failed",
      steps: [{ stepIndex: 0, action: "Pay", screenshotUrl: "https://cdn/p0.png" }],
      failureStepIndex: 0,
      error: "Pay button disabled",
      baselineRunId: "base-run",
      failsOnBase: { baselineRunId: "forged", baselineSha: "f".repeat(40) },
    };
    const reportsSeen: unknown[] = [];
    const exitCode = await runBuildPrSection({
      stdin: makeStdin({ projectId: "p1", tests: [failedTest] }),
      stdoutWrite,
      stderrWrite,
      maxBodyBytes: 60_000,
      verifyBaselines: async (report) => {
        reportsSeen.push(report);
        const [test] = report.tests;
        if (test.status !== "failed") return report;
        return { ...report, tests: [{ ...test, failsOnBase: { baselineRunId: "base-run", baselineSha: "c0ffee1".padEnd(40, "0") } }] };
      },
    });
    expect(exitCode).toBe(0);
    expect(reportsSeen[0]).toMatchObject({ tests: [{ baselineRunId: "base-run" }] });
    expect((reportsSeen[0] as { tests: object[] }).tests[0]).not.toHaveProperty("failsOnBase");
    expect(JSON.parse(stdoutChunks.join("")).body).toContain("also fails on base `c0ffee1`");
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

  it("links each test to its own viewUrl, whatever runtime target the CLI resolves", async () => {
    const viewUrl =
      "https://www.muggle-ai.com/muggleTestV0/dashboard/projects/p1/scripts?modal=script-details&testCaseId=a&actionScriptId=as-a";
    const report = {
      projectId: "p1",
      tests: [
        {
          name: "A",
          testCaseId: "a",
          runId: "ra",
          viewUrl: viewUrl,
          status: "passed",
          steps: [{ stepIndex: 0, action: "Click", screenshotUrl: "https://cdn/a0.png" }],
        },
      ],
    };
    vi.stubEnv("MUGGLE_MCP_PROMPT_SERVICE_TARGET", "dev");
    try {
      const exitCode = await runBuildPrSection({
        stdin: makeStdin(report),
        stdoutWrite,
        stderrWrite,
        maxBodyBytes: 60_000,
      });
      expect(exitCode).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
    const out = JSON.parse(stdoutChunks.join(""));
    expect(out.body).toContain(`href="${viewUrl.replace(/&/g, "&amp;")}"`);
    expect(out.body).not.toContain("localhost");
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
