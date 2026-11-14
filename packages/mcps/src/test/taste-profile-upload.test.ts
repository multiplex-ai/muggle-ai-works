/** Tests for the taste profile upload consent gate and the remote taste profile tools. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const upstreamExecute = vi.hoisted(() => vi.fn());

vi.mock("../shared/config.js", () => ({
  getConfig: () => ({
    logLevel: "silent",
    serverName: "test",
    serverVersion: "0.0.0",
    e2e: { promptServiceBaseUrl: "http://test.invalid", requestTimeoutMs: 1000, workflowTimeoutMs: 1000 },
  }),
}));

vi.mock("../shared/logger.js", () => {
  const noop = () => undefined;
  const fakeLogger = { info: noop, warn: noop, error: noop, debug: noop, verbose: noop, silly: noop, child: () => fakeLogger };
  return { getLogger: () => fakeLogger, createChildLogger: () => fakeLogger, resetLogger: noop };
});

vi.mock("../mcp/e2e/upstream-client.js", () => ({ getPromptServiceClient: () => ({ execute: upstreamExecute }) }));

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";
import { uploadTasteProfileAsync } from "../mcp/tools/e2e/taste-profile-upload.js";
import { TasteProfileUploadOutcome } from "../mcp/tools/e2e/taste-profile-upload-types.js";
import { writePreferences } from "../shared/preferences-service.js";
import { PreferenceKey, PreferenceValue } from "../shared/preferences-types.js";
import { TASTE_REDACTION_MARKER, TASTE_SECTION_STATEMENT_CHARACTER_BUDGET } from "../shared/taste-profile/constants.js";
import { writeTasteProfileSections } from "../shared/taste-profile/taste-profile-store.js";
import { resolveTasteProfileUploadDecision } from "../shared/taste-profile/taste-profile-upload-gate.js";
import { TasteCategory, TasteProfileUploadDecision, type ITasteSection } from "../shared/taste-profile/types.js";

function buildSection(statement: string): ITasteSection {
  return {
    preferences: [
      { statement: statement, category: TasteCategory.Naming, signalCount: 3, lastSeenAt: "2026-11-01T00:00:00.000Z" },
    ],
    distilledAt: "2026-11-02T00:00:00.000Z",
  };
}

let dataDir: string;

function setUploadPreference(preferenceValue: PreferenceValue): void {
  writePreferences({ [PreferenceKey.TasteProfileUpload]: preferenceValue }, dataDir);
}

function upload(hasUserApprovedThisUpload: boolean) {
  return uploadTasteProfileAsync({
    hasUserApprovedThisUpload: hasUserApprovedThisUpload,
    correlationId: "test-correlation",
    dataDirOverride: dataDir,
  });
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "taste-upload-"));
  upstreamExecute.mockReset();
  upstreamExecute.mockResolvedValue({ statusCode: 200, data: { userSection: null, projectSections: {} }, headers: {} });
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("resolveTasteProfileUploadDecision", () => {
  it.each([
    [PreferenceValue.Never, true, TasteProfileUploadDecision.Refuse],
    [PreferenceValue.Never, false, TasteProfileUploadDecision.Refuse],
    [PreferenceValue.Always, false, TasteProfileUploadDecision.Upload],
    [PreferenceValue.Ask, true, TasteProfileUploadDecision.Upload],
    [PreferenceValue.Ask, false, TasteProfileUploadDecision.NeedsConsent],
  ])("%s with approval %s → %s", (preferenceValue, hasUserApprovedThisUpload, expectedDecision) => {
    expect(resolveTasteProfileUploadDecision(preferenceValue, hasUserApprovedThisUpload)).toBe(expectedDecision);
  });
});

describe("uploadTasteProfileAsync", () => {
  it("sends nothing when the local profile is empty", async () => {
    setUploadPreference(PreferenceValue.Always);
    const uploadResult = await upload(true);

    expect(uploadResult.outcome).toBe(TasteProfileUploadOutcome.NothingToUpload);
    expect(upstreamExecute).not.toHaveBeenCalled();
  });

  it("refuses under never, even with approval", async () => {
    writeTasteProfileSections({ userSection: buildSection("Use kebab-case routes") }, dataDir);
    setUploadPreference(PreferenceValue.Never);

    const uploadResult = await upload(true);

    expect(uploadResult.outcome).toBe(TasteProfileUploadOutcome.Refused);
    expect(upstreamExecute).not.toHaveBeenCalled();
  });

  it("asks for consent under the default ask, returning the screened profile", async () => {
    writeTasteProfileSections({ userSection: buildSection("Ping ops@example.com on failures") }, dataDir);

    const uploadResult = await upload(false);

    expect(uploadResult.outcome).toBe(TasteProfileUploadOutcome.NeedsConsent);
    expect(uploadResult.redactionCount).toBe(1);
    expect(uploadResult.screenedProfile?.userSection?.preferences[0].statement).toBe(`Ping ${TASTE_REDACTION_MARKER} on failures`);
    expect(upstreamExecute).not.toHaveBeenCalled();
  });

  it("uploads the screened sections under ask with approval", async () => {
    writeTasteProfileSections(
      { userSection: buildSection("Ping ops@example.com on failures"), projectSections: { p1: buildSection("Name tables in plural") } },
      dataDir,
    );

    const uploadResult = await upload(true);

    expect(uploadResult.outcome).toBe(TasteProfileUploadOutcome.Uploaded);
    expect(uploadResult.hasUploadedUserSection).toBe(true);
    expect(uploadResult.uploadedProjectIds).toEqual(["p1"]);
    expect(upstreamExecute).toHaveBeenCalledTimes(1);
    const [upstreamCall, credentials, correlationId] = upstreamExecute.mock.calls[0];
    expect(upstreamCall.method).toBe("PUT");
    expect(upstreamCall.path).toBe("/v1/protected/muggle-test/taste-profile");
    expect(upstreamCall.body.userSection.preferences[0].statement).toBe(`Ping ${TASTE_REDACTION_MARKER} on failures`);
    expect(upstreamCall.body.projectSections.p1).toEqual(buildSection("Name tables in plural"));
    expect(credentials).toEqual({ bearerToken: "test-token" });
    expect(correlationId).toBe("test-correlation");
  });

  it("uploads under always without approval and omits a missing user section", async () => {
    writeTasteProfileSections({ projectSections: { p1: buildSection("Dates as YYYY-MM-DD") } }, dataDir);
    setUploadPreference(PreferenceValue.Always);

    const uploadResult = await upload(false);

    expect(uploadResult.outcome).toBe(TasteProfileUploadOutcome.Uploaded);
    expect(upstreamExecute.mock.calls[0][0].body).toEqual({ projectSections: { p1: buildSection("Dates as YYYY-MM-DD") } });
  });

  it("refuses a section over the budget without sending", async () => {
    fs.mkdirSync(path.join(dataDir, "taste"), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "taste", "profile.json"),
      JSON.stringify({ userSection: buildSection("x".repeat(TASTE_SECTION_STATEMENT_CHARACTER_BUDGET + 1)), projectSections: {} }),
    );
    setUploadPreference(PreferenceValue.Always);

    const uploadResult = await upload(false);

    expect(uploadResult.outcome).toBe(TasteProfileUploadOutcome.OverBudget);
    expect(upstreamExecute).not.toHaveBeenCalled();
  });
});

describe("remote taste profile tools", () => {
  it("get passes projectId as a query parameter", () => {
    const upstreamCall = getQaToolByName("muggle-remote-taste-profile-get")!.mapToUpstream({ projectId: "p1" });
    expect(upstreamCall).toEqual({
      method: "GET",
      path: "/v1/protected/muggle-test/taste-profile",
      queryParams: { projectId: "p1" },
    });
  });

  it("delete targets the whole profile when no projectId is given", () => {
    const upstreamCall = getQaToolByName("muggle-remote-taste-profile-delete")!.mapToUpstream({});
    expect(upstreamCall).toEqual({
      method: "DELETE",
      path: "/v1/protected/muggle-test/taste-profile",
      queryParams: { projectId: undefined },
    });
  });

  it("upload runs locally through the consent gate", () => {
    const uploadTool = getQaToolByName("muggle-remote-taste-profile-upload")!;
    expect(uploadTool.localHandler).toBeDefined();
    expect(uploadTool.inputSchema.safeParse({ hasUserApprovedThisUpload: true }).success).toBe(true);
  });
});
