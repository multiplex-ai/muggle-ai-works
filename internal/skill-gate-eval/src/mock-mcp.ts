/**
 * In-process MCP server that shadows the muggle namespace with canned
 * responses. The agent SDK mounts this server, the agent calls its
 * tools by their prefixed names (`mcp__plugin_muggle_muggle__<bare>`),
 * and the canned handlers return scenario-appropriate fixtures so the
 * skill can complete a run without authenticating, without contacting
 * cloud APIs, and without launching Electron.
 *
 * Call recording happens in the harness via `canUseTool`, not here —
 * the handlers are pure stubs.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { Fixtures, MockServerHandle } from "./types.js";

const PERMISSIVE_SHAPE = {} as const;

/**
 * Schema for the execute-* tools. The fields the gates care about
 * (`showUi`, `freshSession`) MUST be declared here — zod strips
 * undeclared keys before the SDK forwards them to canUseTool, so the
 * agent's emitted args would arrive empty otherwise.
 */
const EXECUTE_SHAPE = {
  testCase: z.unknown().optional(),
  testScript: z.unknown().optional(),
  actionScript: z.unknown().optional(),
  localUrl: z.string().optional(),
  showUi: z.boolean().optional(),
  freshSession: z.boolean().optional(),
  timeoutMs: z.number().optional(),
} as const;

function jsonResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

/**
 * Build the in-process muggle MCP server. The server name
 * `plugin_muggle_muggle` matches the prefix used in production so the
 * SKILL.md's bare tool references (`muggle-local-execute-test-generation`)
 * resolve to the same `mcp__plugin_muggle_muggle__<name>` handles.
 */
export function buildMockMcpServer(fixtures: Fixtures): MockServerHandle {
  const config = createSdkMcpServer({
    name: "eval_mock",
    version: "0.0.0-eval",
    tools: [
      tool(
        "muggle-local-telemetry-skill-emit",
        "Telemetry sink (mock).",
        PERMISSIVE_SHAPE,
        async () => jsonResult({ ok: true }),
      ),
      tool(
        "muggle-local-telemetry-event-emit",
        "Failure-mode telemetry sink (mock).",
        PERMISSIVE_SHAPE,
        async () => jsonResult({ ok: true }),
      ),
      tool(
        "muggle-local-check-status",
        "MCP server / local status (mock).",
        PERMISSIVE_SHAPE,
        async () =>
          jsonResult(
            fixtures.checkStatus ?? {
              ok: true,
              authenticated: true,
              email: "tester@example.com",
            },
          ),
      ),
      tool(
        "muggle-remote-auth-status",
        "Auth status (mock).",
        PERMISSIVE_SHAPE,
        async () =>
          jsonResult(
            fixtures.authStatus ?? { authenticated: true, email: "tester@example.com" },
          ),
      ),
      tool(
        "muggle-remote-auth-login",
        "Auth login (mock).",
        PERMISSIVE_SHAPE,
        async () =>
          jsonResult({
            verificationUrl: "https://example.invalid/login",
            code: "STUB",
          }),
      ),
      tool(
        "muggle-remote-auth-poll",
        "Auth poll (mock).",
        PERMISSIVE_SHAPE,
        async () =>
          jsonResult({ status: "complete", email: "tester@example.com" }),
      ),
      tool(
        "muggle-local-last-project-get",
        "Last-project cache get (mock).",
        PERMISSIVE_SHAPE,
        async () => jsonResult(fixtures.lastProject ?? null),
      ),
      tool(
        "muggle-local-last-project-set",
        "Last-project cache set (mock).",
        PERMISSIVE_SHAPE,
        async () => jsonResult({ ok: true }),
      ),
      tool(
        "muggle-local-last-host-get",
        "Last-host cache get (mock).",
        PERMISSIVE_SHAPE,
        async () => jsonResult(fixtures.lastHost ?? null),
      ),
      tool(
        "muggle-local-last-host-set",
        "Last-host cache set (mock).",
        PERMISSIVE_SHAPE,
        async () => jsonResult({ ok: true }),
      ),
      tool(
        "muggle-remote-project-list",
        "Project list (mock).",
        PERMISSIVE_SHAPE,
        async () => jsonResult(fixtures.projects ?? { items: [] }),
      ),
      tool(
        "muggle-remote-use-case-list",
        "Use-case list (mock).",
        PERMISSIVE_SHAPE,
        async () => jsonResult(fixtures.useCases ?? { items: [] }),
      ),
      tool(
        "muggle-remote-test-case-list-by-use-case",
        "Test-case list (mock).",
        PERMISSIVE_SHAPE,
        async () => jsonResult(fixtures.testCases ?? { items: [] }),
      ),
      tool(
        "muggle-remote-test-case-get",
        "Test-case get (mock).",
        PERMISSIVE_SHAPE,
        async () =>
          jsonResult(
            fixtures.testCase ?? { id: "tc-stub", title: "Stub test case" },
          ),
      ),
      tool(
        "muggle-remote-test-script-list",
        "Test-script list (mock — none).",
        PERMISSIVE_SHAPE,
        async () => jsonResult({ items: [] }),
      ),
      tool(
        "muggle-local-execute-test-generation",
        "Execute test generation (mock — args recorded by canUseTool, never actually runs).",
        EXECUTE_SHAPE,
        async () =>
          jsonResult(
            fixtures.executeResult ?? {
              runId: "run-stub",
              status: "passed",
              viewUrl: "https://example.invalid/run/stub",
            },
          ),
      ),
      tool(
        "muggle-local-execute-replay",
        "Execute replay (mock — args recorded by canUseTool, never actually runs).",
        EXECUTE_SHAPE,
        async () =>
          jsonResult(
            fixtures.executeResult ?? {
              runId: "run-stub",
              status: "passed",
              viewUrl: "https://example.invalid/run/stub",
            },
          ),
      ),
      tool(
        "muggle-local-run-result-get",
        "Run result (mock).",
        PERMISSIVE_SHAPE,
        async () =>
          jsonResult(
            fixtures.runResult ?? {
              runId: "run-stub",
              status: "passed",
              steps: [],
              viewUrl: "https://example.invalid/run/stub",
              cloudTestScriptId: "cloud-ts-stub",
              cloudActionScriptId: "cloud-as-stub",
            },
          ),
      ),
    ],
  });

  return { config: config };
}
