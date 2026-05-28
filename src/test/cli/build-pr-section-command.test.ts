import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Readable } from "stream";

vi.mock("../../cli/pr-section/resolve-urls.js", () => ({
  resolveGsScreenshotUrls: vi.fn(async (report: unknown) => report),
}));

import {
  runBuildPrSection,
  buildPrSectionCommand,
  DEFAULT_MAX_BODY_BYTES,
} from "../../cli/build-pr-section.js";

const validReport = {
  projectId: "p1",
  tests: [
    {
      name: "A",
      testCaseId: "a",
      runId: "ra",
      viewUrl: "https://example.com/a",
      status: "passed",
      steps: [{ stepIndex: 0, action: "Click", screenshotUrl: "https://cdn/a0.png" }],
    },
  ],
};

describe("runBuildPrSection error paths", () => {
  let stderrChunks: string[];
  const stderrWrite = (s: string): boolean => {
    stderrChunks.push(s);
    return true;
  };
  const stdoutWrite = (): boolean => true;

  beforeEach(() => {
    stderrChunks = [];
  });

  it("returns 1 when reading stdin throws", async () => {
    const failing = new Readable({
      read() {
        this.destroy(new Error("pipe broken"));
      },
    });
    const code = await runBuildPrSection({
      stdin: failing,
      stdoutWrite,
      stderrWrite,
      maxBodyBytes: 60_000,
    });
    expect(code).toBe(1);
    expect(stderrChunks.join("")).toMatch(/failed to read stdin: pipe broken/);
  });
});

describe("buildPrSectionCommand", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdinSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    stdinSpy?.mockRestore();
    process.exitCode = undefined;
  });

  it("rejects a non-positive --max-body-bytes without reading stdin", async () => {
    await buildPrSectionCommand({ maxBodyBytes: "0" });
    expect(process.exitCode).toBe(1);
    expect(String(stderrSpy.mock.calls[0][0])).toMatch(/must be a positive number/);
  });

  it("rejects a non-numeric --max-body-bytes", async () => {
    await buildPrSectionCommand({ maxBodyBytes: "abc" });
    expect(process.exitCode).toBe(1);
  });

  it("succeeds end-to-end reading process.stdin and writing stdout", async () => {
    stdinSpy = vi
      .spyOn(process, "stdin", "get")
      .mockReturnValue(Readable.from([JSON.stringify(validReport)]) as never);

    await buildPrSectionCommand({});

    expect(process.exitCode).toBeUndefined();
    const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(written);
    expect(parsed.body).toContain("E2E Acceptance Results");
  });

  it("sets a nonzero exit code when the report is invalid", async () => {
    stdinSpy = vi
      .spyOn(process, "stdin", "get")
      .mockReturnValue(Readable.from(["not json"]) as never);

    await buildPrSectionCommand({ maxBodyBytes: String(DEFAULT_MAX_BODY_BYTES) });

    expect(process.exitCode).toBe(1);
  });
});
