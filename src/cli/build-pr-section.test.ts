import { describe, it, expect, beforeEach } from "vitest";
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
