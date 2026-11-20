/**
 * Tests for the Slack and GitHub integration tools on the cloud E2E registry.
 *
 * Covers:
 *   - each tool's upstream verb, path, query params and body
 *   - descriptions pointing first-time connection at the dashboard and asking to confirm a disconnect
 */

import { describe, expect, it, vi } from "vitest";

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

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import { GithubConfigSetInputSchema, SlackChannelSetInputSchema } from "../mcp/e2e/contracts/index.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MUGGLE_TEST_PATH = "/v1/protected/muggle-test";
const GITHUB_PATH = `${MUGGLE_TEST_PATH}/projects/${PROJECT_ID}/github`;

function mapToolInput(toolName: string, toolInput: Record<string, unknown>) {
  const tool = getQaToolByName(toolName)!;
  return tool.mapToUpstream(tool.inputSchema.parse(toolInput));
}

describe("Slack tools", () => {
  it("lists channels by project query", () => {
    const upstreamCall = mapToolInput("muggle-remote-slack-channel-list", { projectId: PROJECT_ID });

    expect(upstreamCall.method).toBe("GET");
    expect(upstreamCall.path).toBe(`${MUGGLE_TEST_PATH}/slack/channels`);
    expect(upstreamCall.queryParams).toEqual({ projectId: PROJECT_ID });
  });

  it("posts the chosen channel with the project in the body", () => {
    const upstreamCall = mapToolInput("muggle-remote-slack-channel-set", {
      projectId: PROJECT_ID,
      channelId: "C0123456789",
      channelName: "qa-reports",
    });

    expect(upstreamCall.method).toBe("POST");
    expect(upstreamCall.path).toBe(`${MUGGLE_TEST_PATH}/slack/channel`);
    expect(upstreamCall.body).toEqual({ projectId: PROJECT_ID, channelId: "C0123456789", channelName: "qa-reports" });
  });

  it("disconnects by project query", () => {
    const upstreamCall = mapToolInput("muggle-remote-slack-disconnect", { projectId: PROJECT_ID });

    expect(upstreamCall.method).toBe("DELETE");
    expect(upstreamCall.path).toBe(`${MUGGLE_TEST_PATH}/slack/connection`);
    expect(upstreamCall.queryParams).toEqual({ projectId: PROJECT_ID });
  });

  it("requires a channel id", () => {
    expect(SlackChannelSetInputSchema.safeParse({ projectId: PROJECT_ID, channelId: "" }).success).toBe(false);
  });
});

describe("GitHub tools", () => {
  it("lists the reachable repositories", () => {
    const upstreamCall = mapToolInput("muggle-remote-github-repository-list", { projectId: PROJECT_ID });

    expect(upstreamCall.method).toBe("GET");
    expect(upstreamCall.path).toBe(`${GITHUB_PATH}/repositories`);
  });

  it("puts the repository and pull request", () => {
    const upstreamCall = mapToolInput("muggle-remote-github-config-set", {
      projectId: PROJECT_ID,
      owner: "muggle-ai",
      repo: "works",
      pullRequestNumber: 42,
    });

    expect(upstreamCall.method).toBe("PUT");
    expect(upstreamCall.path).toBe(`${GITHUB_PATH}/config`);
    expect(upstreamCall.body).toEqual({ owner: "muggle-ai", repo: "works", pullRequestNumber: 42 });
  });

  it("disconnects at the project's github path", () => {
    const upstreamCall = mapToolInput("muggle-remote-github-disconnect", { projectId: PROJECT_ID });

    expect(upstreamCall.method).toBe("DELETE");
    expect(upstreamCall.path).toBe(GITHUB_PATH);
  });

  it.each([
    ["a missing repo", { projectId: PROJECT_ID, owner: "muggle-ai" }],
    ["a pull request number of 0", { projectId: PROJECT_ID, owner: "muggle-ai", repo: "works", pullRequestNumber: 0 }],
  ])("rejects %s", (_caseName, toolInput) => {
    expect(GithubConfigSetInputSchema.safeParse(toolInput).success).toBe(false);
  });
});

describe("integration tool descriptions", () => {
  it.each(["muggle-remote-slack-channel-list", "muggle-remote-github-repository-list"])(
    "%s says the first connection happens in the dashboard",
    (toolName) => {
      expect(getQaToolByName(toolName)!.description).toContain("Muggle dashboard");
    },
  );

  it.each(["muggle-remote-slack-disconnect", "muggle-remote-github-disconnect"])("%s asks to confirm first", (toolName) => {
    expect(getQaToolByName(toolName)!.description).toContain("Confirm with the user first");
  });
});
