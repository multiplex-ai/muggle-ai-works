import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../shared/config.js", () => ({
  getConfig: () => ({
    logLevel: "silent",
    serverName: "test",
    serverVersion: "0.0.0",
    e2e: { promptServiceBaseUrl: "http://test.invalid", requestTimeoutMs: 1000, workflowTimeoutMs: 1000 },
  }),
  getDashboardBaseUrl: () => "https://dashboard.test/muggleTestV0/dashboard/projects",
}));

vi.mock("../shared/logger.js", () => {
  const noop = () => undefined;
  const fakeLogger = { info: noop, warn: noop, error: noop, debug: noop, verbose: noop, silly: noop, child: () => fakeLogger };
  return { getLogger: () => fakeLogger, createChildLogger: () => fakeLogger, resetLogger: noop };
});

vi.mock("../mcp/e2e/upstream-client.js", () => ({ getPromptServiceClient: () => ({ execute: vi.fn() }) }));

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import { buildDashboardUrl } from "../shared/dashboard-link/index.js";
import { BUG_REPORT_MAX_SCREENSHOT_BYTES } from "../shared/bug-report/index.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";
import type { IQaToolDefinition, IUpstreamCall } from "../mcp/e2e/types.js";

const BUG_REPORT_ID = "bug-7f3a";
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let screenshotDir: string;

const bugReportTool = (toolName: string): IQaToolDefinition => getQaToolByName(toolName)!;

const mapValidated = (toolName: string, toolInput: unknown): IUpstreamCall => {
  const tool = bugReportTool(toolName);
  return tool.mapToUpstream(tool.inputSchema.parse(toolInput));
};

const writeScreenshot = (fileName: string, fileBytes: Buffer): string => {
  const screenshotPath = path.join(screenshotDir, fileName);
  fs.writeFileSync(screenshotPath, fileBytes);
  return screenshotPath;
};

const validCreateInput = {
  title: "Replay hangs after login",
  description: "The local replay never finishes.",
  severity: "major",
};

beforeAll(() => {
  screenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), "bug-report-screenshots-"));
});

afterAll(() => {
  fs.rmSync(screenshotDir, { recursive: true, force: true });
});

describe("muggle-remote-bug-report-create", () => {
  it("posts the report as a JSON payload field filed from the harness", () => {
    const upstreamCall = mapValidated("muggle-remote-bug-report-create", {
      ...validCreateInput,
      stepsToReproduce: "1. Run a replay",
      clientContext: { cliVersion: "5.35.0", lastProjectId: "token=abc123", homeDirectory: "/home/someone" },
    });

    expect(upstreamCall.method).toBe("POST");
    expect(upstreamCall.path).toBe("/v1/protected/bug-reports");
    expect(upstreamCall.multipartFormData?.files).toEqual([]);
    expect(JSON.parse(upstreamCall.multipartFormData!.textFields!.payload)).toEqual({
      title: "Replay hangs after login",
      description: "The local replay never finishes.",
      severity: "major",
      stepsToReproduce: "1. Run a replay",
      source: "harness",
      clientContext: { cliVersion: "5.35.0" },
    });
  });

  it("attaches each screenshot read from disk under the screenshots field", () => {
    const firstScreenshotPath = writeScreenshot("hang.png", PNG_BYTES);
    const secondScreenshotPath = writeScreenshot("error.JPG", Buffer.from([0xff, 0xd8, 0xff]));

    const upstreamCall = mapValidated("muggle-remote-bug-report-create", {
      ...validCreateInput,
      screenshotPaths: [firstScreenshotPath, secondScreenshotPath],
    });

    expect(upstreamCall.multipartFormData?.files).toEqual([
      { fieldName: "screenshots", fileName: "hang.png", contentType: "image/png", fileBase64: PNG_BYTES.toString("base64") },
      { fieldName: "screenshots", fileName: "error.JPG", contentType: "image/jpeg", fileBase64: "/9j/" },
    ]);
  });

  it.each([
    ["a non-image file", () => writeScreenshot("notes.txt", Buffer.from("hello")), /is not an image/],
    ["a missing file", () => path.join(screenshotDir, "missing.png"), /was not found/],
    ["an empty file", () => writeScreenshot("empty.png", Buffer.alloc(0)), /is empty/],
    ["an oversized file", () => writeScreenshot("huge.png", Buffer.alloc(BUG_REPORT_MAX_SCREENSHOT_BYTES + 1)), /larger than 5 MB/],
  ])("refuses %s", (_label, createScreenshotPath, expectedMessage) => {
    expect(() =>
      mapValidated("muggle-remote-bug-report-create", { ...validCreateInput, screenshotPaths: [createScreenshotPath()] }),
    ).toThrow(expectedMessage);
  });

  it.each([
    ["an unknown severity", { ...validCreateInput, severity: "critical" }],
    ["a blank title", { ...validCreateInput, title: "  " }],
    ["a missing description", { title: "Hang", severity: "minor" }],
    ["six screenshots", { ...validCreateInput, screenshotPaths: ["1.png", "2.png", "3.png", "4.png", "5.png", "6.png"] }],
  ])("rejects %s", (_label, toolInput) => {
    expect(bugReportTool("muggle-remote-bug-report-create").inputSchema.safeParse(toolInput).success).toBe(false);
  });

  it("links the filed report to its ticket page", () => {
    const dashboardLink = bugReportTool("muggle-remote-bug-report-create").dashboardLink!(validCreateInput, {
      statusCode: 201,
      data: { bugReportId: BUG_REPORT_ID, shortId: "BUG-4821" },
      headers: {},
    });

    expect(buildDashboardUrl(dashboardLink!)).toBe(
      `https://dashboard.test/muggleTestV0/dashboard/bug-reports/${BUG_REPORT_ID}`,
    );
  });
});

describe("muggle-remote-bug-report-list", () => {
  it("passes the page size and cursor as query parameters", () => {
    const upstreamCall = mapValidated("muggle-remote-bug-report-list", { pageSize: 20, cursor: "next-1" });

    expect(upstreamCall).toEqual({
      method: "GET",
      path: "/v1/protected/bug-reports",
      queryParams: { pageSize: 20, cursor: "next-1" },
    });
  });

  it("rejects a page larger than the route serves", () => {
    expect(bugReportTool("muggle-remote-bug-report-list").inputSchema.safeParse({ pageSize: 51 }).success).toBe(false);
  });
});

describe("muggle-remote-bug-report-get", () => {
  it("reads one ticket by its id", () => {
    expect(mapValidated("muggle-remote-bug-report-get", { bugReportId: BUG_REPORT_ID })).toEqual({
      method: "GET",
      path: `/v1/protected/bug-reports/${BUG_REPORT_ID}`,
    });
  });

  it("points a short id at the list instead of sending it", () => {
    const parseOutcome = bugReportTool("muggle-remote-bug-report-get").inputSchema.safeParse({ bugReportId: "BUG-4821" });

    expect(parseOutcome.success).toBe(false);
    expect(JSON.stringify(parseOutcome.error?.issues)).toContain("muggle-remote-bug-report-list");
  });
});

describe("muggle-remote-bug-report-reply", () => {
  it("posts the message and screenshots to the ticket's replies", () => {
    const screenshotPath = writeScreenshot("after.webp", PNG_BYTES);

    const upstreamCall = mapValidated("muggle-remote-bug-report-reply", {
      bugReportId: BUG_REPORT_ID,
      message: "Still happens on 5.35.0",
      screenshotPaths: [screenshotPath],
    });

    expect(upstreamCall.method).toBe("POST");
    expect(upstreamCall.path).toBe(`/v1/protected/bug-reports/${BUG_REPORT_ID}/replies`);
    expect(upstreamCall.multipartFormData?.textFields).toEqual({ message: "Still happens on 5.35.0" });
    expect(upstreamCall.multipartFormData?.files.map((screenshotFile) => screenshotFile.contentType)).toEqual(["image/webp"]);
  });

  it("rejects an empty message", () => {
    expect(
      bugReportTool("muggle-remote-bug-report-reply").inputSchema.safeParse({ bugReportId: BUG_REPORT_ID, message: "" }).success,
    ).toBe(false);
  });
});
