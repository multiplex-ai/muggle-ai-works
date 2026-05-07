/**
 * In-process MCP server that shadows the muggle namespace with canned
 * responses driven by a fixtures map. Every tool the skill might call
 * during the path under test must have a stub here, otherwise the
 * agent will block on a real MCP call and the run will hang.
 *
 * The harness wires this server into the agent SDK as the muggle MCP
 * provider for the duration of one scenario run.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export interface MockCall {
  tool: string;
  args: unknown;
  resultJson: string;
}

export interface MockMcpHandle {
  server: Server;
  calls: MockCall[];
}

interface ToolStub {
  name: string;
  description: string;
  /** Returns the canned result given the tool args and shared fixtures. */
  respond: (
    args: Record<string, unknown>,
    fixtures: Record<string, unknown>,
  ) => unknown;
}

const STUBS: ToolStub[] = [
  {
    name: "muggle-local-telemetry-skill-emit",
    description: "stub: telemetry sink",
    respond: () => ({ ok: true }),
  },
  {
    name: "muggle-remote-auth-status",
    description: "stub: auth status",
    respond: (_a, fx) => fx.authStatus ?? { authenticated: true, email: "tester@example.com" },
  },
  {
    name: "muggle-remote-auth-login",
    description: "stub: auth login",
    respond: () => ({ verificationUrl: "https://example.invalid/login", code: "STUB" }),
  },
  {
    name: "muggle-remote-auth-poll",
    description: "stub: auth poll",
    respond: () => ({ status: "complete", email: "tester@example.com" }),
  },
  {
    name: "muggle-local-last-project-get",
    description: "stub: last project cache get",
    respond: (_a, fx) => fx.lastProject ?? null,
  },
  {
    name: "muggle-local-last-project-set",
    description: "stub: last project cache set",
    respond: () => ({ ok: true }),
  },
  {
    name: "muggle-local-last-host-get",
    description: "stub: last host cache get",
    respond: (_a, fx) => fx.lastHost ?? null,
  },
  {
    name: "muggle-local-last-host-set",
    description: "stub: last host cache set",
    respond: () => ({ ok: true }),
  },
  {
    name: "muggle-remote-project-list",
    description: "stub: project list",
    respond: (_a, fx) => fx.projects ?? { items: [] },
  },
  {
    name: "muggle-remote-use-case-list",
    description: "stub: use case list",
    respond: (_a, fx) => fx.useCases ?? { items: [] },
  },
  {
    name: "muggle-remote-test-case-list-by-use-case",
    description: "stub: test case list",
    respond: (_a, fx) => fx.testCases ?? { items: [] },
  },
  {
    name: "muggle-remote-test-case-get",
    description: "stub: test case get",
    respond: (_a, fx) => fx.testCase ?? { id: "tc-stub", title: "Stub test case" },
  },
  {
    name: "muggle-remote-test-script-list",
    description: "stub: test script list (none)",
    respond: () => ({ items: [] }),
  },
  {
    name: "muggle-local-execute-test-generation",
    description: "stub: execute generation (records args, never runs)",
    respond: (_a, fx) =>
      fx.executeResult ?? {
        runId: "run-stub",
        status: "passed",
        viewUrl: "https://example.invalid/run/stub",
      },
  },
  {
    name: "muggle-local-execute-replay",
    description: "stub: execute replay (records args, never runs)",
    respond: (_a, fx) =>
      fx.executeResult ?? {
        runId: "run-stub",
        status: "passed",
        viewUrl: "https://example.invalid/run/stub",
      },
  },
  {
    name: "muggle-local-publish-test-script",
    description: "stub: publish",
    respond: () => ({ viewUrl: "https://example.invalid/script/stub" }),
  },
  {
    name: "muggle-local-run-result-get",
    description: "stub: run result",
    respond: (_a, fx) =>
      fx.runResult ?? {
        runId: "run-stub",
        status: "passed",
        steps: [],
      },
  },
];

export function buildMockMcpServer(
  fixtures: Record<string, unknown>,
): MockMcpHandle {
  const calls: MockCall[] = [];
  const server = new Server(
    { name: "muggle-mock", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: STUBS.map((s) => ({
      name: s.name,
      description: s.description,
      inputSchema: { type: "object", additionalProperties: true },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, (req) => {
    const stub = STUBS.find((s) => s.name === req.params.name);
    if (!stub) {
      throw new Error(`Mock MCP: unknown tool ${req.params.name}`);
    }
    const result = stub.respond(
      (req.params.arguments ?? {}) as Record<string, unknown>,
      fixtures,
    );
    const resultJson = JSON.stringify(result);
    calls.push({ tool: stub.name, args: req.params.arguments, resultJson });
    return {
      content: [{ type: "text" as const, text: resultJson }],
    };
  });

  return { server, calls };
}
