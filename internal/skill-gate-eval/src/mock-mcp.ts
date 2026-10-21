/**
 * In-process MCP server that shadows the muggle namespace with canned
 * responses. The agent SDK mounts this server, the agent calls its
 * tools by their prefixed names (`mcp__eval_mock__<bare>`), and the
 * canned handlers return scenario-appropriate fixtures so the skill can
 * complete a run without authenticating, without contacting cloud APIs,
 * and without launching Electron.
 *
 * Call recording happens in the harness via `canUseTool`, not here —
 * the handlers are pure stubs. The tool list itself lives in
 * mock-tools.ts, shared with the stdio server the Codex harness mounts.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

import { jsonResult, mockToolSpecs } from "./mock-tools.js";
import type { Fixtures, MockServerHandle } from "./types.js";

/** Build the in-process mock server for the agent SDK. */
export function buildMockMcpServer(fixtures: Fixtures): MockServerHandle {
  const config = createSdkMcpServer({
    name: "eval_mock",
    version: "0.0.0-eval",
    tools: mockToolSpecs(fixtures).map((spec) =>
      tool(spec.name, spec.description, spec.shape, async () => jsonResult(spec.reply())),
    ),
  });

  return { config: config };
}
