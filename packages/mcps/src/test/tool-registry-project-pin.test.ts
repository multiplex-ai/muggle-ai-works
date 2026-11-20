/**
 * Tests for the project pin tools on the cloud E2E registry.
 *
 * Covers:
 *   - pin and unpin mapping to the project's pin route with no body
 *   - schema rejection of a projectId that is not a UUID
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

import { ProjectPinInputSchema } from "../mcp/e2e/contracts/index.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PIN_PATH = `/v1/protected/muggle-test/projects/${PROJECT_ID}/pin`;

describe("project pin tools", () => {
  it.each([
    ["muggle-remote-project-pin", "PUT"],
    ["muggle-remote-project-unpin", "DELETE"],
  ])("%s sends %s to the pin route with no body", (toolName, expectedMethod) => {
    const tool = getQaToolByName(toolName)!;
    const upstreamCall = tool.mapToUpstream(tool.inputSchema.parse({ projectId: PROJECT_ID }));

    expect(upstreamCall.method).toBe(expectedMethod);
    expect(upstreamCall.path).toBe(PIN_PATH);
    expect(upstreamCall.body).toBeUndefined();
  });

  it("requires a project UUID", () => {
    expect(ProjectPinInputSchema.safeParse({ projectId: "PRJ-1" }).success).toBe(false);
  });
});
