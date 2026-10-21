/** Tests for MCP host detection. */

import { describe, expect, it } from "vitest";

import { detectMcpHost, MCP_HOST_ENV_VAR } from "../shared/host_detection.js";

describe("detectMcpHost", () => {
  it("returns the host a shipped config stamps, ahead of every heuristic", () => {
    expect(detectMcpHost({ [MCP_HOST_ENV_VAR]: "codex", CLAUDE_CODE: "1" })).toBe("codex");
  });

  it("accepts a stamp regardless of case and surrounding space", () => {
    expect(detectMcpHost({ [MCP_HOST_ENV_VAR]: " Codex " })).toBe("codex");
  });

  // Codex starts MCP servers with only HOME, PATH and the locale, so without
  // the stamp its servers carry no host signal at all.
  it("cannot tell Codex from an unknown host without the stamp", () => {
    expect(detectMcpHost({ HOME: "/home/u", PATH: "/usr/bin", LANG: "C.UTF-8" })).toBe("unknown");
  });

  it("ignores a stamp naming no known host", () => {
    expect(detectMcpHost({ [MCP_HOST_ENV_VAR]: "vim", CURSOR_TRACE_ID: "t" })).toBe("cursor");
    expect(detectMcpHost({ [MCP_HOST_ENV_VAR]: "unknown" })).toBe("unknown");
  });

  it.each([
    [{ CLAUDE_CODE: "1" }, "claude-code"],
    [{ CLAUDECODE: "1" }, "claude-code"],
    [{ CURSOR_TRACE_ID: "trace" }, "cursor"],
    [{ CODEX: "1" }, "codex"],
    [{ WINDSURF_MCP: "1" }, "windsurf"],
  ] as const)("falls back to the environment signal %o", (env, expected) => {
    expect(detectMcpHost(env)).toBe(expected);
  });
});
