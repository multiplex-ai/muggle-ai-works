/**
 * Tests for organization ownership on the project tools: the organizationId
 * parameter on project create and update, and the organization list tool an
 * agent reads it from.
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
      workflowTimeoutMs: 5000,
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
  return {
    getLogger: () => fakeLogger,
    createChildLogger: () => fakeLogger,
    resetLogger: noop,
  };
});

vi.mock("../mcp/e2e/upstream-client.js", () => ({
  getPromptServiceClient: () => ({ execute: vi.fn() }),
}));

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import { ProjectCreateInputSchema, ProjectUpdateInputSchema } from "../mcp/e2e/contracts/index.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const ORGANIZATION_ID = "55555555-5555-4555-8555-555555555555";
const CREATE_INPUT = {
  projectName: "Checkout",
  description: "Checkout flows",
  url: "https://shop.example.com",
};

describe("muggle-remote-project-create organizationId", () => {
  it("sends organizationId so the project is created under the organization", () => {
    const call = getQaToolByName("muggle-remote-project-create")!.mapToUpstream({
      ...CREATE_INPUT,
      organizationId: ORGANIZATION_ID,
    });
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/v1/protected/muggle-test/projects");
    expect(call.body).toEqual({
      name: "Checkout",
      description: "Checkout flows",
      url: "https://shop.example.com",
      organizationId: ORGANIZATION_ID,
    });
  });

  it("leaves organizationId out of the body for a personal project", () => {
    const call = getQaToolByName("muggle-remote-project-create")!.mapToUpstream(CREATE_INPUT);
    expect(call.body).not.toHaveProperty("organizationId");
  });

  it("rejects an organizationId that is not a UUID", () => {
    expect(() => ProjectCreateInputSchema.parse({ ...CREATE_INPUT, organizationId: "acme" })).toThrow();
  });
});

describe("muggle-remote-project-update organizationId", () => {
  it("sends organizationId to move a personal project into the organization", () => {
    const call = getQaToolByName("muggle-remote-project-update")!.mapToUpstream({
      projectId: PROJECT_ID,
      organizationId: ORGANIZATION_ID,
    });
    expect(call.method).toBe("PUT");
    expect(call.path).toBe(`/v1/protected/muggle-test/projects/${PROJECT_ID}`);
    expect(call.body).toEqual({ id: PROJECT_ID, organizationId: ORGANIZATION_ID });
  });

  it("leaves organizationId out when only other fields change", () => {
    const call = getQaToolByName("muggle-remote-project-update")!.mapToUpstream({
      projectId: PROJECT_ID,
      projectName: "Renamed",
    });
    expect(call.body).toEqual({ id: PROJECT_ID, name: "Renamed" });
    expect(call.body).not.toHaveProperty("organizationId");
  });

  it("rejects an organizationId that is not a UUID", () => {
    expect(() => ProjectUpdateInputSchema.parse({ projectId: PROJECT_ID, organizationId: "acme" })).toThrow();
  });
});

describe("muggle-remote-organization-list", () => {
  it("reads the caller's memberships without a request body", () => {
    const tool = getQaToolByName("muggle-remote-organization-list");
    expect(tool).toBeDefined();
    expect(tool!.requiresAuth).not.toBe(false);
    const call = tool!.mapToUpstream({});
    expect(call.method).toBe("GET");
    expect(call.path).toBe("/v1/protected/organizations/my-organizations");
    expect(call.body).toBeUndefined();
  });

  it("returns one row per organization without billing identifiers", () => {
    const tool = getQaToolByName("muggle-remote-organization-list")!;
    const output = tool.mapFromUpstream!({
      statusCode: 200,
      headers: {},
      data: {
        organizations: [
          {
            organization: {
              id: ORGANIZATION_ID,
              name: "Acme",
              slug: "acme",
              status: "ACTIVE",
              stripeCustomerId: "cus_123",
              seatCount: 5,
            },
            role: "OWNER",
          },
        ],
      },
    });
    expect(output).toEqual({
      organizations: [{ organizationId: ORGANIZATION_ID, name: "Acme", status: "ACTIVE", role: "OWNER" }],
    });
  });

  it("returns an empty list for a user without organizations", () => {
    const tool = getQaToolByName("muggle-remote-organization-list")!;
    const output = tool.mapFromUpstream!({ statusCode: 200, headers: {}, data: { organizations: [] } });
    expect(output).toEqual({ organizations: [] });
  });
});
