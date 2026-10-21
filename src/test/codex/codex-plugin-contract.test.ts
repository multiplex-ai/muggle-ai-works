import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { blockStop, denyTool, envelope, mergeHookOutputs } from "../../guardrails/emit.js";

// Codex validates a plugin mostly by ignoring what it does not accept: an
// unknown MCP server key, an extra or over-long default prompt, a manifest path
// that does not start with "./" — each is dropped with a log line and the
// plugin loads without it. A hook whose output it cannot parse is marked failed
// and skipped. These pin the plugin to Codex 0.163.0's own rules
// (codex-rs/core-plugins, codex-rs/config/src/mcp_types.rs,
// codex-rs/hooks/src/schema.rs) so nothing the plugin declares goes missing.

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const PLUGIN_ROOT = join(REPO_ROOT, "plugin");
const CODEX_MANIFEST = join(PLUGIN_ROOT, ".codex-plugin", "plugin.json");
const CODEX_MARKETPLACE = join(REPO_ROOT, ".agents", "plugins", "marketplace.json");

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf-8")) as T;

interface CodexManifest {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  skills: string;
  mcpServers: string;
  hooks: string;
  interface: Record<string, unknown> & { defaultPrompt: string[]; capabilities: string[] };
}

interface CodexMarketplace {
  name: string;
  plugins: Array<{ name: string; source: string | { source: string; path: string }; policy?: Record<string, unknown> }>;
}

// A plugin or marketplace name segment (core-plugin-common/src/plugin_id.rs).
const PLUGIN_NAME = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
const MARKETPLACE_NAME = /^[A-Za-z0-9_-]+$/;
const PLUGIN_VERSION = /^[A-Za-z0-9._+-]+$/;
const MAX_DEFAULT_PROMPTS = 3;
const MAX_DEFAULT_PROMPT_LENGTH = 128;
const MCP_SERVER_NAME = /^[a-zA-Z0-9_:@/.-]+$/;
// Every key a stdio server may set; any other is ignored without a word.
const STDIO_SERVER_KEYS = new Set([
  "command", "args", "env", "env_vars", "cwd", "enabled", "required", "startup_readiness", "startup_timeout_sec",
  "startup_timeout_ms", "tool_timeout_sec", "environment_id", "supports_parallel_tool_calls",
  "tool_input_schema_max_bytes", "omit_tools_from", "default_tools_approval_mode", "enabled_tools", "disabled_tools",
  "tools",
]);
const MARKETPLACE_POLICY_VALUES: Record<string, string[]> = {
  installation: ["NOT_AVAILABLE", "AVAILABLE", "INSTALLED_BY_DEFAULT"],
  authentication: ["ON_INSTALL", "ON_USE"],
};

function isPluginRelativePath(path: string): boolean {
  return path.startsWith("./") && path !== "./" && !path.split("/").includes("..");
}

describe("the Codex plugin manifest", () => {
  const manifest = readJson<CodexManifest>(CODEX_MANIFEST);
  const marketplace = readJson<CodexMarketplace>(CODEX_MARKETPLACE);

  it("is a regular file, with no agent-plugins manifest at the root to take precedence", () => {
    expect(lstatSync(CODEX_MANIFEST).isFile()).toBe(true);
    expect(existsSync(join(PLUGIN_ROOT, "plugin.json"))).toBe(false);
  });

  it("names the plugin the way Codex ids it, matching its marketplace entry", () => {
    expect(manifest.name).toMatch(PLUGIN_NAME);
    expect(marketplace.plugins.map((plugin) => plugin.name)).toContain(manifest.name);
  });

  it("carries a version Codex can name a cache directory after", () => {
    expect(typeof manifest.version).toBe("string");
    expect(manifest.version).toMatch(PLUGIN_VERSION);
  });

  it("types every field the way Codex reads it, or Codex rejects the whole manifest", () => {
    expect(typeof manifest.description).toBe("string");
    expect(manifest.keywords.every((keyword) => typeof keyword === "string")).toBe(true);
    expect(manifest.interface.capabilities.every((capability) => typeof capability === "string")).toBe(true);
    for (const field of ["displayName", "shortDescription", "longDescription", "developerName", "category", "websiteURL"]) {
      expect(typeof manifest.interface[field], field).toBe("string");
    }
  });

  it.each(["skills", "mcpServers", "hooks"] as const)("points %s at a file inside the plugin", (field) => {
    const path = manifest[field];
    expect(isPluginRelativePath(path), path).toBe(true);
    expect(existsSync(join(PLUGIN_ROOT, path)), path).toBe(true);
  });

  it("offers only the default prompts Codex keeps", () => {
    const prompts = manifest.interface.defaultPrompt;
    expect(prompts.length).toBeLessThanOrEqual(MAX_DEFAULT_PROMPTS);
    for (const prompt of prompts) {
      expect(prompt.split(/\s+/).join(" ").length, prompt).toBeLessThanOrEqual(MAX_DEFAULT_PROMPT_LENGTH);
    }
  });
});

describe("the Codex marketplace", () => {
  const marketplace = readJson<CodexMarketplace>(CODEX_MARKETPLACE);

  it("has a name `codex plugin marketplace add` accepts", () => {
    expect(marketplace.name).toMatch(MARKETPLACE_NAME);
  });

  // One bad enum value fails the whole marketplace; a bad entry is skipped.
  it.each(marketplace.plugins.map((plugin) => [plugin.name, plugin] as const))(
    "lists %s with a local source and policy Codex resolves",
    (_name, plugin) => {
      expect(plugin.name).toMatch(PLUGIN_NAME);
      const source = typeof plugin.source === "string" ? plugin.source : plugin.source.path;
      expect(isPluginRelativePath(source), source).toBe(true);
      expect(existsSync(join(REPO_ROOT, source)), source).toBe(true);
      for (const [key, value] of Object.entries(plugin.policy ?? {})) {
        if (key in MARKETPLACE_POLICY_VALUES) expect(MARKETPLACE_POLICY_VALUES[key]).toContain(value);
      }
    },
  );
});

describe("the Codex MCP server config", () => {
  const manifest = readJson<CodexManifest>(CODEX_MANIFEST);
  const servers = readJson<{ mcpServers: Record<string, Record<string, unknown>> }>(join(PLUGIN_ROOT, manifest.mcpServers))
    .mcpServers;

  it.each(Object.entries(servers))("%s is a stdio server Codex starts as configured", (name, server) => {
    expect(name).toMatch(MCP_SERVER_NAME);
    expect(typeof server.command).toBe("string");
    expect(server.url).toBeUndefined();
    expect(Object.keys(server).filter((key) => !STDIO_SERVER_KEYS.has(key))).toEqual([]);
  });

  // A required server that cannot start (offline npx, a broken install) fails
  // every Codex session; optional, Codex runs on without its tools.
  it.each(Object.entries(servers))("%s stays optional", (_name, server) => {
    expect(server.required ?? false).toBe(false);
  });
});

// codex-rs/hooks/src/schema.rs: every hook output struct is deny_unknown_fields,
// and a hookEventName outside the known set fails the parse. A hook whose
// output fails is skipped, and nobody — not the model, not `--json` — is told.
const UNIVERSAL_OUTPUT_KEYS = ["continue", "stopReason", "suppressOutput", "systemMessage"];
const CODEX_OUTPUT_KEYS: Record<string, { topLevel: string[]; hookSpecific?: string[] }> = {
  SessionStart: { topLevel: [...UNIVERSAL_OUTPUT_KEYS, "hookSpecificOutput"], hookSpecific: ["hookEventName", "additionalContext"] },
  UserPromptSubmit: {
    topLevel: [...UNIVERSAL_OUTPUT_KEYS, "decision", "reason", "hookSpecificOutput"],
    hookSpecific: ["hookEventName", "additionalContext"],
  },
  PreToolUse: {
    topLevel: ["systemMessage", "decision", "reason", "hookSpecificOutput"],
    hookSpecific: ["hookEventName", "permissionDecision", "permissionDecisionReason", "updatedInput", "additionalContext"],
  },
  PostToolUse: {
    topLevel: [...UNIVERSAL_OUTPUT_KEYS, "decision", "reason", "hookSpecificOutput"],
    hookSpecific: ["hookEventName", "additionalContext", "updatedMCPToolOutput"],
  },
  Stop: { topLevel: [...UNIVERSAL_OUTPUT_KEYS, "decision", "reason"] },
};

/** Why Codex would reject this output for this event, or undefined when it parses. */
function codexRejection(event: string, stdout: string): string | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  let output: Record<string, unknown>;
  try {
    output = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // SessionStart and UserPromptSubmit take plain text as context; Stop does not.
    return event === "SessionStart" || event === "UserPromptSubmit" ? undefined : "not JSON";
  }
  const allowed = CODEX_OUTPUT_KEYS[event];
  const extraTop = Object.keys(output).filter((key) => !allowed.topLevel.includes(key));
  if (extraTop.length > 0) return `unknown keys ${extraTop.join(", ")}`;
  const specific = output.hookSpecificOutput as Record<string, unknown> | undefined;
  if (specific) {
    if (specific.hookEventName !== event) return `hookEventName ${String(specific.hookEventName)}`;
    const extra = Object.keys(specific).filter((key) => !allowed.hookSpecific!.includes(key));
    if (extra.length > 0) return `unknown hookSpecificOutput keys ${extra.join(", ")}`;
    if (event === "PreToolUse" && specific.permissionDecision !== undefined) {
      if (specific.permissionDecision !== "deny") return `permissionDecision ${String(specific.permissionDecision)}`;
      if (!specific.permissionDecisionReason) return "a deny without a reason";
    }
  }
  if (output.decision !== undefined && output.decision !== "block") return `decision ${String(output.decision)}`;
  if (output.reason !== undefined && output.decision === undefined) return "a reason without a decision";
  return undefined;
}

describe("guardrail hook output under Codex", () => {
  it("parses, for every shape a gate answers with", () => {
    const samples: Array<[string, string]> = [
      ["SessionStart", envelope("SessionStart", "context", "codex")],
      ["UserPromptSubmit", envelope("UserPromptSubmit", "route it", "codex")],
      ["PostToolUse", envelope("PostToolUse", "a PR opened", "codex")],
      ["PreToolUse", denyTool("not classified", "codex")],
      ["Stop", blockStop("keep going", "codex")],
      ["Stop", mergeHookOutputs([blockStop("first", "codex"), blockStop("second", "codex")], "codex")],
      ["PreToolUse", mergeHookOutputs([denyTool("first", "codex"), envelope("PreToolUse", "note", "codex")], "codex")],
      ["PostToolUse", mergeHookOutputs([envelope("PostToolUse", "a", "codex"), "{}"], "codex")],
      ["Stop", mergeHookOutputs(["{}", "{}"], "codex")],
    ];
    expect(samples.map(([event, stdout]) => [event, codexRejection(event, stdout)])).toEqual(
      samples.map(([event]) => [event, undefined]),
    );
  });

  // Run as Codex runs them: CLAUDE_PLUGIN_ROOT exported, the host stamp set.
  it.skipIf(process.platform === "win32").each(["reconcile-stale-watchers.sh"])(
    "%s answers SessionStart in a shape Codex parses",
    (script) => {
      const home = mkdtempSync(join(tmpdir(), "codex-contract-home-"));
      const run = spawnSync("bash", [join(PLUGIN_ROOT, "scripts", script)], {
        input: JSON.stringify({ session_id: "codex-contract", hook_event_name: "SessionStart", source: "startup" }),
        encoding: "utf-8",
        env: { ...process.env, HOME: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, MUGGLE_HOOK_HOST: "codex" },
      });
      expect(run.status).toBe(0);
      expect(codexRejection("SessionStart", run.stdout)).toBeUndefined();
    },
  );
});
