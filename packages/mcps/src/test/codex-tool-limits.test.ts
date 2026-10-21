import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

// Load the real tool registries without the package.json muggleConfig / cloud
// client / auth side effects (same stubs as mcp-tool-surface.test.ts).
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
  const fake = { info: noop, warn: noop, error: noop, debug: noop, verbose: noop, silly: noop, child: () => fake };
  return { getLogger: () => fake, createChildLogger: () => fake, resetLogger: noop };
});

vi.mock("../mcp/e2e/upstream-client.js", () => ({ getPromptServiceClient: () => ({ execute: vi.fn() }) }));

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import { allQaToolDefinitions } from "../mcp/tools/e2e/tool-registry.js";
import { allLocalQaTools } from "../mcp/tools/local/index.js";

// Codex 0.163.0 offers an MCP tool to the model as `mcp__<server>__<tool>`,
// every character outside [A-Za-z0-9_] turned into `_` (codex-rs/codex-mcp).
// Past 128 bytes — or when two names collapse onto one — it replaces the name
// with a truncated hash, and past 5,000 bytes it compacts a tool's input schema,
// stripping every argument description first. Each changes what the model sees
// with no error anywhere, so the surface is held inside all three.
const CODEX_NAMESPACE = "mcp__muggle";
const CODEX_MAX_TOOL_NAME_BYTES = 128;
const CODEX_TOOL_INPUT_SCHEMA_MAX_BYTES = 5000;

const tools = [...allQaToolDefinitions, ...allLocalQaTools] as Array<{ name: string; inputSchema: z.ZodType }>;
const codexToolName = (name: string): string => name.replace(/[^A-Za-z0-9_]/g, "_");

describe("the muggle MCP tool surface under Codex", () => {
  it("keeps every tool's name distinct once Codex respells it", () => {
    const respelled = tools.map((tool) => codexToolName(tool.name));
    expect(new Set(respelled).size).toBe(respelled.length);
  });

  it.each(tools.map((tool) => [tool.name, tool] as const))("%s keeps its name unhashed", (_name, tool) => {
    expect(Buffer.byteLength(`${CODEX_NAMESPACE}__${codexToolName(tool.name)}`)).toBeLessThanOrEqual(
      CODEX_MAX_TOOL_NAME_BYTES,
    );
  });

  // The same conversion the server answers tools/list with (src/server/mcp-server.ts).
  it.each(tools.map((tool) => [tool.name, tool] as const))("%s keeps its argument descriptions", (_name, tool) => {
    const schema = z.toJSONSchema(tool.inputSchema) as { type?: unknown };
    expect(schema.type).toBe("object");
    expect(Buffer.byteLength(JSON.stringify(schema))).toBeLessThanOrEqual(CODEX_TOOL_INPUT_SCHEMA_MAX_BYTES);
  });
});
