import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appendFileSync, readFileSync } from "fs";
import { join } from "path";
import { CODEX_BIN, CodexSession, REPO_ROOT } from "./support/codexSession.js";
import { MockResponsesServer, assistantMessage, muggleToolCall, toolCallOutput } from "./support/mockResponsesServer.js";
import type { ScriptedTurn } from "./support/types.js";

// The README's "Headless runs" setting, held to what the pinned Codex does:
// `codex exec` cannot ask for approval, so under its own sandbox it refuses a
// muggle MCP call until the user approves the plugin's tools. The setting is
// read out of the README, so the documented TOML is the one tested.

const LIVE_TIMEOUT_MS = 180_000;
const STATUS_TOOL = "muggle-local-check-status";

/** The TOML block the README's Codex section gives for headless runs. */
function readmeHeadlessToml(): string {
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf-8");
  const block = /\*\*Headless runs\.\*\*[\s\S]*?```toml\r?\n([\s\S]*?)```/.exec(readme);
  if (!block) throw new Error("README.md has no Headless runs TOML block");
  return block[1].replace(/^ {2}/gm, "");
}

describe.skipIf(!CODEX_BIN)("headless muggle runs in a real Codex", () => {
  const model = new MockResponsesServer();
  const session = new CodexSession(model);
  let statusOutput = "";
  const callStatus: ScriptedTurn = (request, index) => {
    if (index === 0) return muggleToolCall("status", STATUS_TOOL, {});
    statusOutput = toolCallOutput(request, "status");
    return assistantMessage("Checked.");
  };

  beforeAll(async () => {
    await model.start();
    session.prepare();
  }, LIVE_TIMEOUT_MS);

  afterAll(async () => {
    await model.stop();
  });

  it("refuses a muggle MCP call until its tools are approved, and runs it once they are", async () => {
    await session.exec("$muggle:muggle-status check my install", callStatus, "read-only");
    expect(statusOutput).toContain("MCP tool call requires approval, but approval policy is never");

    appendFileSync(join(session.codexHome, "config.toml"), `\n${readmeHeadlessToml()}`);
    await session.exec("$muggle:muggle-status check my install", callStatus, "read-only");
    expect(statusOutput).toContain("Muggle Test Local Status");
  }, LIVE_TIMEOUT_MS);
});
