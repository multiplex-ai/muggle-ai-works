import { describe, it, expect, vi } from "vitest";

// Load the real tool registries without the package.json muggleConfig / cloud
// client / auth side effects (same stubs as tool-registry-pagination.test.ts).
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

// The advertised MCP surface is exactly what getQaTools()/getLocalQaTools()
// register — name + description + inputSchema per tool, passed through unchanged
// from these two registries (see mcp/e2e/index.ts and mcp/local/index.ts).
const allTools = [...allQaToolDefinitions, ...allLocalQaTools] as Array<{
  name: string;
  description: string;
  inputSchema: unknown;
}>;
const surface = allTools
  .map((t) => ({ name: t.name, description: t.description }))
  .sort((a, b) => a.name.localeCompare(b.name));
const names = surface.map((s) => s.name);

describe("MCP tool surface (Lazy-core parity oracle)", () => {
  // The lazy-server refactor advertises the full tool surface from cheap
  // description data before loading any tool's machinery. These snapshots pin
  // that surface — names and descriptions — so a lazy-load regression that
  // drops, renames, or re-words a tool fails here instead of shipping silently.
  // A legitimate tool add/edit updates the snapshot in the same reviewed PR.

  it("advertises the exact set of tool names", () => {
    expect(names).toMatchSnapshot();
  });

  it("advertises the exact name + description for every tool", () => {
    expect(surface).toMatchSnapshot();
  });

  it("loads a substantial, unique, well-named surface", () => {
    expect(names.length).toBeGreaterThanOrEqual(50);
    expect(new Set(names).size).toBe(names.length); // no duplicate tool names
    for (const name of names) {
      expect(name, `${name} must use the muggle-(remote|local)- prefix`).toMatch(
        /^muggle-(remote|local)-[a-z0-9-]+$/,
      );
    }
  });

  it("every advertised tool carries a non-empty description and an input schema", () => {
    for (const t of allTools) {
      expect(typeof t.description === "string" && t.description.trim().length > 0, `${t.name} description`).toBe(true);
      expect(t.inputSchema != null, `${t.name} inputSchema`).toBe(true);
    }
  });
});
