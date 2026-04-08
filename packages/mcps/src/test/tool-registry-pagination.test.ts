/**
 * Tests for the cloud E2E tool registry around the list-endpoint pagination contract.
 *
 * Covers:
 *   - muggle-remote-test-script-list-paginated is removed
 *   - snapshot of the four list-tool specs catches accidental drift
 *   - smoke test per list tool: mocked upstream response is relayed unchanged
 *
 * See designs/list-endpoint-pagination.md Section 5 (MCP testing).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  return {
    getLogger: () => fakeLogger,
    createChildLogger: () => fakeLogger,
    resetLogger: noop,
  };
});

// Mock upstream client before importing the tool registry so the singleton
// getter hands back our fake. The fake's execute() is reset in beforeEach.
const mockExecute = vi.fn();
vi.mock("../mcp/e2e/upstream-client.js", () => ({
  getPromptServiceClient: () => ({ execute: mockExecute }),
}));

// Mock credentials so executeQaTool doesn't try to read real auth state.
vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import {
  allQaToolDefinitions,
  executeQaTool,
  getQaToolByName,
} from "../mcp/tools/e2e/tool-registry.js";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "22222222-2222-4222-8222-222222222222";

/** Expected contract phrasing in each of the four list-tool descriptions. */
const PAGINATION_DESCRIPTION_FRAGMENT =
  "Returns up to 10 items per page by default (max 100). Response includes pagination metadata (totalCount, totalPages, hasMore)";

/** The four list tools that share PaginationInputSchema. */
const LIST_TOOL_NAMES = [
  "muggle-remote-project-list",
  "muggle-remote-use-case-list",
  "muggle-remote-test-case-list",
  "muggle-remote-test-script-list",
] as const;

describe("cloud E2E tool registry — pagination", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("does not expose muggle-remote-test-script-list-paginated", () => {
    expect(getQaToolByName("muggle-remote-test-script-list-paginated")).toBeUndefined();
    const names = allQaToolDefinitions.map((t) => t.name);
    expect(names).not.toContain("muggle-remote-test-script-list-paginated");
  });

  it("still exposes the four remaining list tools", () => {
    for (const name of LIST_TOOL_NAMES) {
      expect(getQaToolByName(name)).toBeDefined();
    }
  });

  it("list-tool descriptions advertise the pagination contract (snapshot)", () => {
    const snapshot = LIST_TOOL_NAMES.map((name) => {
      const tool = getQaToolByName(name);
      return { name, description: tool?.description };
    });

    // Per-field assertions catch accidental drift before snapshot diffing.
    for (const entry of snapshot) {
      expect(entry.description).toContain(PAGINATION_DESCRIPTION_FRAGMENT);
    }

    expect(snapshot).toMatchInlineSnapshot(`
      [
        {
          "description": "List projects accessible to the authenticated user. Returns up to 10 items per page by default (max 100). Response includes pagination metadata (totalCount, totalPages, hasMore) — check \`hasMore\` to decide whether to fetch additional pages.",
          "name": "muggle-remote-project-list",
        },
        {
          "description": "List use cases for a project. Returns up to 10 items per page by default (max 100). Response includes pagination metadata (totalCount, totalPages, hasMore) — check \`hasMore\` to decide whether to fetch additional pages.",
          "name": "muggle-remote-use-case-list",
        },
        {
          "description": "List test cases for a project. Returns up to 10 items per page by default (max 100). Response includes pagination metadata (totalCount, totalPages, hasMore) — check \`hasMore\` to decide whether to fetch additional pages.",
          "name": "muggle-remote-test-case-list",
        },
        {
          "description": "List test scripts for a project, optionally filtered by test case. Returns up to 10 items per page by default (max 100). Response includes pagination metadata (totalCount, totalPages, hasMore) — check \`hasMore\` to decide whether to fetch additional pages.",
          "name": "muggle-remote-test-script-list",
        },
      ]
    `);
  });

  it("mapToUpstream forwards sortBy/sortOrder alongside page/pageSize for every list tool", () => {
    const cases: Array<{
      name: (typeof LIST_TOOL_NAMES)[number];
      input: Record<string, unknown>;
      expectedPath: string;
      expectedExtraParams?: Record<string, unknown>;
    }> = [
      {
        name: "muggle-remote-project-list",
        input: { page: 2, pageSize: 25, sortBy: "updatedAt", sortOrder: "asc" },
        expectedPath: "/v1/protected/muggle-test/projects",
      },
      {
        name: "muggle-remote-use-case-list",
        input: {
          projectId: VALID_UUID,
          page: 2,
          pageSize: 25,
          sortBy: "updatedAt",
          sortOrder: "asc",
        },
        expectedPath: "/v1/protected/muggle-test/use-cases",
        expectedExtraParams: { projectId: VALID_UUID },
      },
      {
        name: "muggle-remote-test-case-list",
        input: {
          projectId: VALID_UUID,
          page: 2,
          pageSize: 25,
          sortBy: "updatedAt",
          sortOrder: "asc",
        },
        expectedPath: "/v1/protected/muggle-test/test-cases",
        expectedExtraParams: { projectId: VALID_UUID },
      },
      {
        name: "muggle-remote-test-script-list",
        input: {
          projectId: VALID_UUID,
          testCaseId: OTHER_UUID,
          page: 2,
          pageSize: 25,
          sortBy: "updatedAt",
          sortOrder: "asc",
        },
        expectedPath: "/v1/protected/muggle-test/test-scripts",
        expectedExtraParams: { projectId: VALID_UUID, testCaseId: OTHER_UUID },
      },
    ];

    for (const c of cases) {
      const tool = getQaToolByName(c.name)!;
      const call = tool.mapToUpstream(c.input);
      expect(call.method).toBe("GET");
      expect(call.path).toBe(c.expectedPath);
      expect(call.queryParams).toMatchObject({
        page: 2,
        pageSize: 25,
        sortBy: "updatedAt",
        sortOrder: "asc",
        ...(c.expectedExtraParams ?? {}),
      });
    }
  });

  describe("smoke test: upstream envelope is relayed unchanged", () => {
    const makeEnvelope = (label: string) => ({
      data: [
        { id: "row-1", label: `${label}-row-1` },
        { id: "row-2", label: `${label}-row-2` },
      ],
      page: 1,
      pageSize: 10,
      totalCount: 23,
      totalPages: 3,
      hasMore: true,
    });

    const cases: Array<{
      name: (typeof LIST_TOOL_NAMES)[number];
      input: Record<string, unknown>;
    }> = [
      { name: "muggle-remote-project-list", input: {} },
      { name: "muggle-remote-use-case-list", input: { projectId: VALID_UUID } },
      { name: "muggle-remote-test-case-list", input: { projectId: VALID_UUID } },
      { name: "muggle-remote-test-script-list", input: { projectId: VALID_UUID } },
    ];

    for (const c of cases) {
      it(`${c.name} relays the paginated envelope unchanged`, async () => {
        const envelope = makeEnvelope(c.name);
        mockExecute.mockResolvedValueOnce({
          statusCode: 200,
          data: envelope,
          headers: {},
        });

        const result = await executeQaTool(c.name, c.input, "test-correlation-id");
        expect(result.isError).toBe(false);
        const parsed = JSON.parse(result.content as string);
        expect(parsed).toEqual(envelope);
      });

      it(`${c.name} invokes upstream with pagination defaults applied`, async () => {
        mockExecute.mockResolvedValueOnce({
          statusCode: 200,
          data: makeEnvelope(c.name),
          headers: {},
        });

        await executeQaTool(c.name, c.input, "test-correlation-id");

        expect(mockExecute).toHaveBeenCalledOnce();
        const [call] = mockExecute.mock.calls[0];
        expect(call.method).toBe("GET");
        expect(call.queryParams).toMatchObject({
          page: 1,
          pageSize: 10,
          sortBy: "createdAt",
          sortOrder: "desc",
        });
      });
    }
  });
});
