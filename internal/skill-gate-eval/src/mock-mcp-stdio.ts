/**
 * The mock muggle MCP server as a stdio process, for a host that launches its
 * MCP servers itself rather than mounting one in process — Codex.
 *
 * It registers the same canned tools as the agent SDK mount (mock-tools.ts)
 * under the production server name, so the host names them exactly as it
 * names the real ones. Calls are recorded by the host's own event stream, not
 * here.
 *
 * Usage: tsx internal/skill-gate-eval/src/mock-mcp-stdio.ts <fixtures.json>
 */

import * as fs from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { MOCK_STDIO_SERVER_NAME } from "./constants.js";
import { jsonResult, mockToolSpecs } from "./mock-tools.js";
import type { Fixtures } from "./types.js";

/** Serve the mock tools for these fixtures on stdin/stdout until the host closes the pipe. */
export async function serveMockToolsOverStdio(fixtures: Fixtures): Promise<void> {
  const server = new McpServer({ name: MOCK_STDIO_SERVER_NAME, version: "0.0.0-eval" });
  for (const spec of mockToolSpecs(fixtures)) {
    server.registerTool(
      spec.name,
      { description: spec.description, inputSchema: spec.shape },
      async () => jsonResult(spec.reply()),
    );
  }
  await server.connect(new StdioServerTransport());
}

const fixturesPath = process.argv[2];
if (!fixturesPath) {
  process.stderr.write("usage: mock-mcp-stdio.ts <fixtures.json>\n");
  process.exit(2);
}
await serveMockToolsOverStdio(JSON.parse(fs.readFileSync(fixturesPath, "utf8")) as Fixtures);
