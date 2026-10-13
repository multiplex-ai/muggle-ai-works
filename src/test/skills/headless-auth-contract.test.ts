/**
 * Layer 1 of the skill-gate eval: static contract lint for headless authentication.
 *
 * A tool nothing points at is a tool nobody calls. `muggle-remote-auth-register` shipped while the
 * only route the skill offered for a missing identity was the device flow, which cannot complete
 * without a person at a browser — so an unattended agent still stopped and waited for a human, which
 * is the single thing the tool exists to prevent. Prose is the wiring here, and these assertions
 * pin the three places it can come apart:
 *
 * 1. The auth step offers the headless route at all.
 * 2. Every auth tool the skill names is really advertised by the MCP registry, so the instruction
 *    cannot reference a tool that does not exist.
 * 3. Every auth tool the skill names is stubbed in the shared eval mock. An unstubbed tool is not
 *    an empty one — a behavioral eval that reaches for it fails in a way that reads like the
 *    agent's mistake rather than a missing fixture.
 *
 * None of this catches an agent that reads the contract and ignores it. That is the behavioral
 * layer's job.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

const MUGGLE_TEST_SKILL = path.join(REPO_ROOT, "plugin", "skills", "muggle-test", "SKILL.md");
const MUGGLE_TEST_REFERENCE = path.join(
  REPO_ROOT,
  "plugin",
  "skills",
  "muggle-test",
  "reference.md",
);
const TOOL_REGISTRY = path.join(
  REPO_ROOT,
  "packages",
  "mcps",
  "src",
  "mcp",
  "tools",
  "e2e",
  "tool-registry.ts",
);
const EVAL_MOCK_MCP = path.join(REPO_ROOT, "internal", "skill-gate-eval", "src", "mock-mcp.ts");

const REGISTER_TOOL = "muggle-remote-auth-register";

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

/** Auth tool names the skill instructs an agent to call. */
function authToolsNamedBySkill(): string[] {
  const named = read(MUGGLE_TEST_SKILL).match(/muggle-remote-auth-[a-z-]+/g) ?? [];
  return [...new Set(named)];
}

describe("headless authentication contract", () => {
  it("offers a route that does not need a person at a browser", () => {
    const skill = read(MUGGLE_TEST_SKILL);

    expect(skill).toContain(REGISTER_TOOL);
  });

  it("explains when to register rather than log in", () => {
    const skill = read(MUGGLE_TEST_SKILL).toLowerCase();

    // The boundary is what keeps the two apart: registering an address that already has an account
    // fails, and logging in without one cannot succeed.
    expect(skill).toMatch(/no account|there is no account|alreadyregistered/);
  });

  it("lists the tool where the skill's tools are indexed", () => {
    expect(read(MUGGLE_TEST_REFERENCE)).toContain(REGISTER_TOOL);
  });

  it("names only auth tools the MCP registry actually advertises", () => {
    const registry = read(TOOL_REGISTRY);
    const missing = authToolsNamedBySkill().filter((toolName) => !registry.includes(toolName));

    expect(missing).toEqual([]);
  });

  it("stubs every auth tool the skill names, so an eval never meets an unstubbed one", () => {
    const mock = read(EVAL_MOCK_MCP);
    const unstubbed = authToolsNamedBySkill().filter((toolName) => !mock.includes(toolName));

    expect(unstubbed).toEqual([]);
  });
});
