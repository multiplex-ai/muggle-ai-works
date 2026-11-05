import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILLS_DIR = path.join(REPO_ROOT, "plugin", "skills");

const REGISTER_SKILL = path.join(SKILLS_DIR, "muggle-register", "SKILL.md");
const ROUTER_SKILL = path.join(SKILLS_DIR, "muggle", "SKILL.md");
const ALIASES_FILE = path.join(SKILLS_DIR, "_aliases.json");
const ALIAS_COMMAND = path.join(REPO_ROOT, "plugin", "commands", "mregister.md");
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
const EVAL_MOCK_TOOLS = path.join(REPO_ROOT, "internal", "skill-gate-eval", "src", "mock-tools.ts");

// AskUserQuestion refuses a fifth option, so a longer menu never opens at all.
const MAX_MENU_OPTIONS = 4;

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function routerSection(heading: string): string {
  const [, afterHeading = ""] = read(ROUTER_SKILL).split(`## ${heading}\n`);
  return afterHeading.split("\n## ")[0] ?? "";
}

function authToolsNamedBySkill(): string[] {
  return [...new Set(read(REGISTER_SKILL).match(/muggle-remote-auth-[a-z-]+/g) ?? [])];
}

describe("muggle-register contract", () => {
  it("offers account creation from the /muggle menu without exceeding the picker's limit", () => {
    const menuOptions = routerSection("Menu")
      .split("\n")
      .filter((line) => line.startsWith("- "));

    expect(menuOptions.length).toBeLessThanOrEqual(MAX_MENU_OPTIONS);
    expect(menuOptions.some((line) => line.includes("`muggle-register`"))).toBe(true);
  });

  it("keeps a direct route for every skill the menu folded together", () => {
    const routing = routerSection("Routing");

    expect(routing).toContain("→ `muggle-register`");
    expect(routing).toContain("→ `muggle-upgrade`");
  });

  it("registers the alias and its command", () => {
    const { aliases: aliases } = JSON.parse(read(ALIASES_FILE)) as { aliases: string[] };

    expect(aliases).toContain("mregister");
    expect(read(ALIAS_COMMAND)).toContain("`muggle-register`");
  });

  it("handles every outcome the register tool reports", () => {
    const skill = read(REGISTER_SKILL);

    for (const outcome of ["created", "already-registered", "throttled"]) {
      expect(skill).toContain(`\`${outcome}\``);
    }
  });

  it("forbids repeating the password", () => {
    expect(read(REGISTER_SKILL)).toMatch(/never repeat the password/i);
  });

  it("names only auth tools the MCP registry advertises and the eval mock stubs", () => {
    const registry = read(TOOL_REGISTRY);
    const mock = read(EVAL_MOCK_TOOLS);
    const toolNames = authToolsNamedBySkill();

    expect(toolNames.filter((toolName) => !registry.includes(toolName))).toEqual([]);
    expect(toolNames.filter((toolName) => !mock.includes(toolName))).toEqual([]);
  });
});
