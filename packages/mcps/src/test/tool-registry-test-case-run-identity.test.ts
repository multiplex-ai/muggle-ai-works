/**
 * Tests for the test-case run identity fields on the cloud E2E create/update tools
 * and the local fresh-session default.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../shared/config.js", () => ({
  getConfig: () => ({
    logLevel: "silent",
    serverName: "test",
    serverVersion: "0.0.0",
    e2e: {
      promptServiceBaseUrl: "http://test.invalid",
      requestTimeoutMs: 1000,
      workflowTimeoutMs: 1000,
    },
  }),
}));

vi.mock("../shared/logger.js", () => {
  const noop = () => undefined;
  const fakeLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    verbose: noop,
    silly: noop,
    child: () => fakeLogger,
  };
  return { getLogger: () => fakeLogger, createChildLogger: () => fakeLogger, resetLogger: noop };
});

vi.mock("../mcp/e2e/upstream-client.js", () => ({
  getPromptServiceClient: () => ({ execute: vi.fn() }),
}));

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";
import { ExecuteReplayInputSchema } from "../mcp/local/contracts/project-schemas.js";
import { resolveEffectiveFreshSession } from "../mcp/local/services/fresh-session.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const USE_CASE_ID = "22222222-2222-4222-8222-222222222222";
const TEST_CASE_ID = "33333333-3333-4333-8333-333333333333";
const EMAIL_SECRET_ID = "44444444-4444-4444-8444-444444444444";
const PASSWORD_SECRET_ID = "55555555-5555-4555-8555-555555555555";

const PINNED_ACCOUNT = { emailSecretId: EMAIL_SECRET_ID, passwordSecretId: PASSWORD_SECRET_ID };

const CREATE_INPUT = {
  projectId: PROJECT_ID,
  useCaseId: USE_CASE_ID,
  title: "Owner approves applicant",
  description: "Owner approves a pending application",
  goal: "Application becomes approved",
  expectedResult: "Applicant is approved",
  url: "https://staging.example.com",
};

function mapCreate(input: Record<string, unknown>): Record<string, unknown> {
  const tool = getQaToolByName("muggle-remote-test-case-create")!;
  const parsed = tool.inputSchema.parse(input);
  return tool.mapToUpstream(parsed).body as Record<string, unknown>;
}

function mapUpdate(input: Record<string, unknown>): Record<string, unknown> {
  const tool = getQaToolByName("muggle-remote-test-case-update")!;
  const parsed = tool.inputSchema.parse(input);
  return tool.mapToUpstream(parsed).body as Record<string, unknown>;
}

describe("muggle-remote-test-case-create run identity", () => {
  it("carries pinnedAccount and alwaysStartsFreshSession when given", () => {
    const body = mapCreate({ ...CREATE_INPUT, pinnedAccount: PINNED_ACCOUNT, alwaysStartsFreshSession: true });

    expect(body.pinnedAccount).toEqual(PINNED_ACCOUNT);
    expect(body.alwaysStartsFreshSession).toBe(true);
  });

  it("omits both keys when not given", () => {
    const body = mapCreate(CREATE_INPUT);

    expect("pinnedAccount" in body).toBe(false);
    expect("alwaysStartsFreshSession" in body).toBe(false);
  });

  it("rejects a malformed secret id", () => {
    const tool = getQaToolByName("muggle-remote-test-case-create")!;
    const outcome = tool.inputSchema.safeParse({
      ...CREATE_INPUT,
      pinnedAccount: { emailSecretId: "nope", passwordSecretId: PASSWORD_SECRET_ID },
    });

    expect(outcome.success).toBe(false);
  });
});

describe("muggle-remote-test-case-update run identity", () => {
  it("sends null to clear the pin", () => {
    const body = mapUpdate({ testCaseId: TEST_CASE_ID, pinnedAccount: null });

    expect(body.pinnedAccount).toBeNull();
  });

  it("sends the pin and the fresh-session flag when given", () => {
    const body = mapUpdate({
      testCaseId: TEST_CASE_ID,
      pinnedAccount: PINNED_ACCOUNT,
      alwaysStartsFreshSession: false,
    });

    expect(body.pinnedAccount).toEqual(PINNED_ACCOUNT);
    expect(body.alwaysStartsFreshSession).toBe(false);
  });

  it("writes neither key when both are omitted", () => {
    const body = mapUpdate({ testCaseId: TEST_CASE_ID, title: "Renamed" });

    expect("pinnedAccount" in body).toBe(false);
    expect("alwaysStartsFreshSession" in body).toBe(false);
  });

  it("mentions pinned account and fresh session in the description", () => {
    const description = getQaToolByName("muggle-remote-test-case-update")!.description;

    expect(description).toContain("pinned account");
    expect(description).toContain("fresh session");
  });
});

const UPLOAD_INPUT = {
  projectId: PROJECT_ID,
  useCaseId: USE_CASE_ID,
  testCaseId: TEST_CASE_ID,
  runType: "generation",
  productionUrl: "https://staging.example.com/",
  localExecutionContext: {
    originalUrl: "http://localhost:3000/",
    productionUrl: "https://staging.example.com/",
    runByUserId: "auth0|test",
    localExecutionCompletedAt: 1,
    uploadedAt: 2,
  },
  actionScript: [{ step: 1 }],
  status: "passed",
  executionTimeMs: 100,
};

function mapUpload(input: Record<string, unknown>): Record<string, unknown> {
  const tool = getQaToolByName("muggle-remote-local-run-upload")!;
  const parsed = tool.inputSchema.parse(input);
  return tool.mapToUpstream(parsed).body as Record<string, unknown>;
}

describe("muggle-remote-local-run-upload run identity", () => {
  it("records the run's pin and fresh session on the upload", () => {
    const body = mapUpload({ ...UPLOAD_INPUT, pinnedAccount: PINNED_ACCOUNT, freshSession: true });

    expect(body.pinnedAccount).toEqual(PINNED_ACCOUNT);
    expect(body.freshSession).toBe(true);
  });

  it("omits both keys for a run without a pin or a fresh session", () => {
    const body = mapUpload({ ...UPLOAD_INPUT, freshSession: false });

    expect("pinnedAccount" in body).toBe(false);
    expect("freshSession" in body).toBe(false);
  });
});

describe("resolveEffectiveFreshSession", () => {
  it("honors an explicit caller value over the stored flag", () => {
    expect(resolveEffectiveFreshSession({ requestedFreshSession: false, storedAlwaysStartsFreshSession: true })).toBe(false);
    expect(resolveEffectiveFreshSession({ requestedFreshSession: true, storedAlwaysStartsFreshSession: false })).toBe(true);
  });

  it("falls back to the stored flag when the caller omits it", () => {
    expect(resolveEffectiveFreshSession({ requestedFreshSession: undefined, storedAlwaysStartsFreshSession: true })).toBe(true);
  });

  it("stays undefined for a legacy test case", () => {
    expect(resolveEffectiveFreshSession({ requestedFreshSession: undefined, storedAlwaysStartsFreshSession: undefined })).toBeUndefined();
  });
});

// Replay must run as the identity the script was recorded with, which lives on the action script,
// not on the live test case whose pin may have changed since.
describe("muggle-local-execute-replay run identity params", () => {
  it("points pinnedAccount at the recorded action script's actionParams", () => {
    const description = ExecuteReplayInputSchema.shape.pinnedAccount.description ?? "";

    expect(description).toContain("actionParams.pinnedAccount");
    expect(description).toContain("muggle-remote-action-script-get");
    expect(description).not.toContain("muggle-remote-test-case-get");
  });

  it("points freshSession at the recorded action script's actionParams", () => {
    const description = ExecuteReplayInputSchema.shape.freshSession.description ?? "";

    expect(description).toContain("actionParams.freshSession");
    expect(description).toContain("muggle-remote-action-script-get");
  });
});
