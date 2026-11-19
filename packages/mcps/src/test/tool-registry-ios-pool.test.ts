import * as crypto from "node:crypto";
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

import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";
import type { IQaToolDefinition, IUpstreamCall } from "../mcp/e2e/types.js";

const PROJECT_ID = "5365f324-5c5f-4adf-b702-11f457b29b04";
const ARTIFACT_DIGEST = "a".repeat(64);
const ARCHIVE_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0xff, 0x80]);

let archiveDir: string;

const iosPoolTool = (toolName: string): IQaToolDefinition => getQaToolByName(toolName)!;

const mapValidated = (toolName: string, toolInput: unknown): IUpstreamCall => {
  const tool = iosPoolTool(toolName);
  return tool.mapToUpstream(tool.inputSchema.parse(toolInput));
};

const writeArchive = (fileName: string, fileBytes: Buffer): string => {
  const archivePath = path.join(archiveDir, fileName);
  fs.writeFileSync(archivePath, fileBytes);
  return archivePath;
};

const uploadInput = (appZipPath: string) => ({
  projectId: PROJECT_ID,
  appZipPath: appZipPath,
  bundleId: "com.example.notes",
  targetRuntime: "iOS-17-5",
  branch: "main",
  commit: "9f8e7d6",
});

const runView = (overrides: { status: string; result: unknown }) => ({
  run: {
    record: {
      runId: "run-1",
      createdAtMs: 1000,
      request: { projectId: PROJECT_ID, artifactDigest: ARTIFACT_DIGEST, task: "Add a note", deviceType: "iPhone-15" },
    },
    state: { runId: "run-1", status: overrides.status, attemptCount: 1, maxAttempts: 3, statusUpdatedAtMs: 2000 },
    result: overrides.result,
  },
});

beforeAll(() => {
  archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), "ios-build-archives-"));
});

afterAll(() => {
  fs.rmSync(archiveDir, { recursive: true, force: true });
});

describe("muggle-remote-ios-build-upload", () => {
  it("streams the archive from disk with its digest, size and provenance in the query", () => {
    const archivePath = writeArchive("Notes.app.zip", ARCHIVE_BYTES);

    const upstreamCall = mapValidated("muggle-remote-ios-build-upload", uploadInput(archivePath));

    expect(upstreamCall.method).toBe("POST");
    expect(upstreamCall.path).toBe(`/v1/protected/ios-pool/projects/${PROJECT_ID}/artifacts`);
    expect(upstreamCall.queryParams).toEqual({
      digest: crypto.createHash("sha256").update(ARCHIVE_BYTES).digest("hex"),
      bundleId: "com.example.notes",
      targetRuntime: "iOS-17-5",
      branch: "main",
      commit: "9f8e7d6",
      sizeBytes: ARCHIVE_BYTES.length,
      producer: "ci_push",
    });
    expect(upstreamCall.fileBody).toEqual({
      filePath: path.resolve(archivePath),
      contentType: "application/octet-stream",
      sizeBytes: ARCHIVE_BYTES.length,
    });
    expect(upstreamCall.body).toBeUndefined();
    expect(upstreamCall.multipartFormData).toBeUndefined();
  });

  it("hashes an archive larger than one read chunk across every chunk", () => {
    const largeArchiveBytes = crypto.randomBytes(1024 * 1024 * 2 + 17);
    const archivePath = writeArchive("Large.app.zip", largeArchiveBytes);

    const upstreamCall = mapValidated("muggle-remote-ios-build-upload", uploadInput(archivePath));

    expect(upstreamCall.queryParams?.digest).toBe(crypto.createHash("sha256").update(largeArchiveBytes).digest("hex"));
  });

  it("stamps a person's manual upload as dashboard_upload when asked", () => {
    const archivePath = writeArchive("Manual.app.zip", ARCHIVE_BYTES);

    const upstreamCall = mapValidated("muggle-remote-ios-build-upload", {
      ...uploadInput(archivePath),
      producer: "dashboard_upload",
    });

    expect(upstreamCall.queryParams?.producer).toBe("dashboard_upload");
  });

  it("refuses a file that is not a zip", () => {
    const archivePath = writeArchive("Notes.ipa", ARCHIVE_BYTES);

    expect(() => mapValidated("muggle-remote-ios-build-upload", uploadInput(archivePath))).toThrow("is not a .zip file");
  });

  it("refuses a missing archive", () => {
    expect(() =>
      mapValidated("muggle-remote-ios-build-upload", uploadInput(path.join(archiveDir, "Missing.app.zip"))),
    ).toThrow("was not found");
  });

  it("refuses an empty archive", () => {
    const archivePath = writeArchive("Empty.app.zip", Buffer.alloc(0));

    expect(() => mapValidated("muggle-remote-ios-build-upload", uploadInput(archivePath))).toThrow("is empty");
  });
});

describe("muggle-remote-ios-run-create", () => {
  it("sends the run request with default caps and no secrets", () => {
    const upstreamCall = mapValidated("muggle-remote-ios-run-create", {
      projectId: PROJECT_ID,
      artifactDigest: ARTIFACT_DIGEST,
      task: "Add a note titled Groceries",
      deviceType: "iPhone-15",
    });

    expect(upstreamCall.method).toBe("POST");
    expect(upstreamCall.path).toBe("/v1/protected/ios-pool/runs");
    expect(upstreamCall.body).toEqual({
      projectId: PROJECT_ID,
      artifactDigest: ARTIFACT_DIGEST,
      task: "Add a note titled Groceries",
      useCaseId: undefined,
      testCaseId: undefined,
      deviceType: "iPhone-15",
      secretRefs: [],
      caps: { maxSteps: 60, stepTimeoutMs: 120000, runTimeoutMs: 1800000 },
    });
  });

  it("requires a task, use case or test case", () => {
    const inputSchema = iosPoolTool("muggle-remote-ios-run-create").inputSchema;

    expect(
      inputSchema.safeParse({ projectId: PROJECT_ID, artifactDigest: ARTIFACT_DIGEST, deviceType: "iPhone-15" }).success,
    ).toBe(false);
  });

  it("rejects a digest that is not lowercase hex sha256", () => {
    const inputSchema = iosPoolTool("muggle-remote-ios-run-create").inputSchema;

    expect(
      inputSchema.safeParse({ projectId: PROJECT_ID, artifactDigest: "sha256:abc", task: "Add a note", deviceType: "iPhone-15" })
        .success,
    ).toBe(false);
  });

  it("returns the queued run with no verdict yet", () => {
    const tool = iosPoolTool("muggle-remote-ios-run-create");

    const mappedRun = tool.mapFromUpstream!({
      statusCode: 202,
      data: runView({ status: "queued", result: null }),
      headers: {},
    });

    expect(mappedRun).toEqual({
      run: {
        runId: "run-1",
        projectId: PROJECT_ID,
        artifactDigest: ARTIFACT_DIGEST,
        deviceType: "iPhone-15",
        task: "Add a note",
        status: "queued",
        isFinished: false,
        verdict: null,
        attemptCount: 1,
        maxAttempts: 3,
        createdAtMs: 1000,
        statusUpdatedAtMs: 2000,
      },
    });
  });
});

describe("muggle-remote-ios-run-get", () => {
  it("reads the run by its encoded id", () => {
    const upstreamCall = mapValidated("muggle-remote-ios-run-get", { runId: "run/1" });

    expect(upstreamCall).toEqual({ method: "GET", path: "/v1/protected/ios-pool/runs/run%2F1" });
  });

  it("keeps a completed run's verdict apart from its machinery status", () => {
    const mappedRun = iosPoolTool("muggle-remote-ios-run-get").mapFromUpstream!({
      statusCode: 200,
      data: runView({ status: "completed", result: { verdict: "failed", summary: "Save button missing", stepCount: 7 } }),
      headers: {},
    }) as { run: Record<string, unknown> };

    expect(mappedRun.run).toMatchObject({
      status: "completed",
      isFinished: true,
      verdict: "failed",
      summary: "Save button missing",
      stepCount: 7,
    });
  });

  it("reports a machinery failure as a finished status with no verdict", () => {
    const mappedRun = iosPoolTool("muggle-remote-ios-run-get").mapFromUpstream!({
      statusCode: 200,
      data: runView({ status: "infra_error", result: null }),
      headers: {},
    }) as { run: Record<string, unknown> };

    expect(mappedRun.run).toMatchObject({ status: "infra_error", isFinished: true, verdict: null });
  });

  it("rejects a body with no run", () => {
    expect(() =>
      iosPoolTool("muggle-remote-ios-run-get").mapFromUpstream!({ statusCode: 200, data: {}, headers: {} }),
    ).toThrow("carried no run");
  });
});

describe("iOS build list and run steps", () => {
  it("lists a project's builds", () => {
    expect(mapValidated("muggle-remote-ios-build-list", { projectId: PROJECT_ID })).toEqual({
      method: "GET",
      path: `/v1/protected/ios-pool/projects/${PROJECT_ID}/artifacts`,
    });
  });

  it("reads a run's steps", () => {
    expect(mapValidated("muggle-remote-ios-run-steps-get", { runId: "run-1" })).toEqual({
      method: "GET",
      path: "/v1/protected/ios-pool/runs/run-1/steps",
    });
  });
});
