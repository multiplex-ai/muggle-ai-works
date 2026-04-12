/**
 * Tests for the bulk test script generation schema and tool.
 *
 * Covers:
 *   - WorkflowStartTestScriptGenerationBulkInputSchema validates correct input
 *   - WorkflowStartTestScriptGenerationBulkInputSchema rejects invalid input
 *   - muggle-remote-workflow-start-test-script-generation-bulk mapToUpstream produces correct HTTP request
 */

import { describe, expect, it, vi } from "vitest";

// Stub the logger and config modules so importing the tool registry does not
// eagerly load the package.json muggleConfig (which lives in the repo root,
// not in the mcps workspace package).
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

import { WorkflowStartTestScriptGenerationBulkInputSchema } from "../mcp/e2e/contracts/index.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "22222222-2222-4222-8222-222222222222";
const THIRD_UUID = "33333333-3333-4333-8333-333333333333";

// =============================================================================
// Schema Tests
// =============================================================================

describe("WorkflowStartTestScriptGenerationBulkInputSchema", () => {
  it("accepts valid input with testCaseIds", () => {
    const parsed = WorkflowStartTestScriptGenerationBulkInputSchema.parse({
      projectId: VALID_UUID,
      name: "bulk generation",
      testCaseIds: [VALID_UUID, OTHER_UUID],
    });
    expect(parsed.projectId).toBe(VALID_UUID);
    expect(parsed.name).toBe("bulk generation");
    expect(parsed.testCaseIds).toEqual([VALID_UUID, OTHER_UUID]);
  });

  it("accepts valid input without testCaseIds (generates for all eligible)", () => {
    const parsed = WorkflowStartTestScriptGenerationBulkInputSchema.parse({
      projectId: VALID_UUID,
      name: "bulk generation",
    });
    expect(parsed.projectId).toBe(VALID_UUID);
    expect(parsed.name).toBe("bulk generation");
    expect(parsed.testCaseIds).toBeUndefined();
  });

  it("accepts valid input with workflowParams", () => {
    const parsed = WorkflowStartTestScriptGenerationBulkInputSchema.parse({
      projectId: VALID_UUID,
      name: "bulk generation",
      testCaseIds: [VALID_UUID],
      workflowParams: {
        memory: {
          enableSharedTestMemory: true,
        },
      },
    });
    expect(parsed.workflowParams).toEqual({
      memory: { enableSharedTestMemory: true },
    });
  });

  it("rejects missing projectId", () => {
    expect(() =>
      WorkflowStartTestScriptGenerationBulkInputSchema.parse({
        name: "bulk generation",
      })
    ).toThrow();
  });

  it("rejects missing name", () => {
    expect(() =>
      WorkflowStartTestScriptGenerationBulkInputSchema.parse({
        projectId: VALID_UUID,
      })
    ).toThrow();
  });

  it("rejects empty name", () => {
    expect(() =>
      WorkflowStartTestScriptGenerationBulkInputSchema.parse({
        projectId: VALID_UUID,
        name: "",
      })
    ).toThrow();
  });

  it("rejects invalid UUID in projectId", () => {
    expect(() =>
      WorkflowStartTestScriptGenerationBulkInputSchema.parse({
        projectId: "not-a-uuid",
        name: "bulk generation",
      })
    ).toThrow();
  });

  it("rejects invalid UUID in testCaseIds array", () => {
    expect(() =>
      WorkflowStartTestScriptGenerationBulkInputSchema.parse({
        projectId: VALID_UUID,
        name: "bulk generation",
        testCaseIds: [VALID_UUID, "not-a-uuid"],
      })
    ).toThrow();
  });
});

// =============================================================================
// Tool Registry Tests
// =============================================================================

describe("muggle-remote-workflow-start-test-script-generation-bulk tool", () => {
  it("is registered in the tool registry", () => {
    const tool = getQaToolByName("muggle-remote-workflow-start-test-script-generation-bulk");
    expect(tool).toBeDefined();
  });

  it("mapToUpstream produces correct POST request with testCaseIds", () => {
    const tool = getQaToolByName("muggle-remote-workflow-start-test-script-generation-bulk")!;
    const call = tool.mapToUpstream({
      projectId: VALID_UUID,
      name: "muggle-test-regenerate-missing: bulk (3 test cases)",
      testCaseIds: [VALID_UUID, OTHER_UUID, THIRD_UUID],
    });

    expect(call.method).toBe("POST");
    expect(call.path).toBe("/v1/protected/muggle-test/workflow/test-script/test-script-generation/bulk");
    expect(call.body).toEqual({
      projectId: VALID_UUID,
      name: "muggle-test-regenerate-missing: bulk (3 test cases)",
      testCaseIds: [VALID_UUID, OTHER_UUID, THIRD_UUID],
    });
    expect(call.timeoutMs).toBe(5000);
  });

  it("mapToUpstream omits testCaseIds when not provided", () => {
    const tool = getQaToolByName("muggle-remote-workflow-start-test-script-generation-bulk")!;
    const call = tool.mapToUpstream({
      projectId: VALID_UUID,
      name: "bulk generation",
    });

    expect(call.body).toEqual({
      projectId: VALID_UUID,
      name: "bulk generation",
      testCaseIds: undefined,
    });
  });

  it("mapToUpstream includes workflowParams when provided", () => {
    const tool = getQaToolByName("muggle-remote-workflow-start-test-script-generation-bulk")!;
    const call = tool.mapToUpstream({
      projectId: VALID_UUID,
      name: "bulk generation",
      testCaseIds: [VALID_UUID],
      workflowParams: { memory: { enableSharedTestMemory: true } },
    });

    expect(call.body).toEqual({
      projectId: VALID_UUID,
      name: "bulk generation",
      testCaseIds: [VALID_UUID],
      workflowParams: { memory: { enableSharedTestMemory: true } },
    });
  });

  it("mapToUpstream omits workflowParams when not provided", () => {
    const tool = getQaToolByName("muggle-remote-workflow-start-test-script-generation-bulk")!;
    const call = tool.mapToUpstream({
      projectId: VALID_UUID,
      name: "bulk generation",
    });

    expect(call.body).not.toHaveProperty("workflowParams");
  });
});
