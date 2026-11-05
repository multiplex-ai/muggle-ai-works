import { describe, it, expect, vi } from "vitest";
import { execFileSync, spawnSync } from "child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { delimiter, join } from "path";
import { fileURLToPath } from "url";
import { createHookHome, runGuardrailCli } from "./hook-harness/hookHarness.js";

// Runs the real CLI and the real wrapper, so each case costs a Node or bash start.
vi.setConfig({ testTimeout: 60_000 });

const PLUGIN_ROOT = fileURLToPath(new URL("../../../plugin", import.meta.url));
// Forward slashes on every platform: the wrapper finds its siblings by cutting its own path at the last `/`.
const SKILL_STAGES_WRAPPER = join(PLUGIN_ROOT, "scripts", "guardrail-skill-stages.sh").replaceAll("\\", "/");
const SKILL_EMIT_TOOL = "mcp__plugin_muggle_muggle__muggle-local-telemetry-skill-emit";
const REMINDER_TEXT = "A newer @muggleai/works is available (5.32.0 → 5.33.0)";
const SECONDS_PER_HOUR = 3_600;
const UPKEEP_POLL_MS = 100;
const UPKEEP_TIMEOUT_MS = 20_000;
const UPKEEP_STUB_PROGRAMS = ["muggle", "npm", "sleep"];

let hasBash = false;
let hasEpochSeconds = false;
try {
  execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
  hasBash = true;
  execFileSync("bash", ["-c", '[ -n "${EPOCHSECONDS:-}" ]'], { stdio: "ignore" });
  hasEpochSeconds = true;
} catch {
  // bash unavailable, or before 5 as macOS ships it — the cases that need each one skip
}

function homeWithUpgradeAvailable(): string {
  const home = createHookHome("upgrade-reminder-hook-");
  mkdirSync(join(home, ".cache", "muggle"), { recursive: true });
  writeFileSync(join(home, ".cache", "muggle", "upgrade-available"), "5.32.0|5.33.0");
  return home;
}

function skillPayload(sessionId: string, toolName: string, toolInput: Record<string, string>): string {
  return JSON.stringify({
    session_id: sessionId,
    hook_event_name: "PostToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: {},
  });
}

function runSkillStages(home: string, payload: string): string {
  const run = runGuardrailCli({
    home: home,
    cliArgs: ["skill-stages"],
    stdin: payload,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
  });
  expect(run.status).toBe(0);
  return run.stdout;
}

describe("skill-stages upgrade reminder", () => {
  it("reminds on the Skill call and not again on that skill's telemetry emit", () => {
    const home = homeWithUpgradeAvailable();
    expect(runSkillStages(home, skillPayload("once", "Skill", { skill: "muggle:muggle-status" }))).toContain(REMINDER_TEXT);
    expect(runSkillStages(home, skillPayload("once", SKILL_EMIT_TOOL, { skillName: "muggle-status" }))).toBe("{}");
  });

  it("reminds on a telemetry emit with no Skill call before it", () => {
    const home = homeWithUpgradeAvailable();
    expect(runSkillStages(home, skillPayload("typed", SKILL_EMIT_TOOL, { skillName: "muggle-status" }))).toContain(
      REMINDER_TEXT,
    );
  });

  it("carries the reminder beside a skill's required reading", () => {
    const home = homeWithUpgradeAvailable();
    const output = runSkillStages(home, skillPayload("stages", "Skill", { skill: "muggle:muggle-do" }));
    expect(output).toContain("declares required reading");
    expect(output).toContain(REMINDER_TEXT);
  });

  it("stays silent inside the upgrade skill", () => {
    const home = homeWithUpgradeAvailable();
    expect(runSkillStages(home, skillPayload("upgrading", "Skill", { skill: "muggle:muggle-upgrade" }))).toBe("{}");
  });

  it("stays silent when no upgrade is available", () => {
    const home = createHookHome("upgrade-reminder-hook-");
    expect(runSkillStages(home, skillPayload("current", "Skill", { skill: "muggle:muggle-status" }))).toBe("{}");
  });
});

describe.skipIf(!hasBash)("skill-stages upkeep launch", () => {
  function createUpkeepStubDirectory(): string {
    const stubDirectory = createHookHome("upkeep-stubs-");
    for (const program of UPKEEP_STUB_PROGRAMS) {
      const stubPath = join(stubDirectory, program);
      writeFileSync(stubPath, "#!/usr/bin/env bash\nexit 0\n");
      chmodSync(stubPath, 0o755);
    }
    return stubDirectory;
  }

  function homeWithStamp(stampEpochSeconds: number | undefined): string {
    const home = createHookHome("upkeep-launch-");
    const cacheDirectory = join(home, ".cache", "muggle");
    mkdirSync(cacheDirectory, { recursive: true });
    writeFileSync(join(cacheDirectory, "electron-app-checked"), "");
    writeFileSync(join(cacheDirectory, "version-check"), "1.0.0|1.0.0");
    if (stampEpochSeconds !== undefined) {
      writeFileSync(join(cacheDirectory, "session-maintenance-due"), `${stampEpochSeconds}\n`);
    }
    return home;
  }

  function runWrapper(home: string): void {
    spawnSync("bash", [SKILL_STAGES_WRAPPER], {
      input: skillPayload("upkeep", "Skill", { skill: "muggle:muggle-status" }),
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: `${createUpkeepStubDirectory()}${delimiter}${process.env.PATH ?? ""}`,
        CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
        HOME: home,
        USERPROFILE: home,
      },
    });
  }

  const readStamp = (home: string): string =>
    readFileSync(join(home, ".cache", "muggle", "session-maintenance-due"), "utf-8").trim();
  const nowSeconds = (): number => Math.floor(Date.now() / 1_000);

  it.skipIf(!hasEpochSeconds)("launches the upkeep once its stamp has come due, which restamps it", async () => {
    const pastDue = nowSeconds() - SECONDS_PER_HOUR;
    const home = homeWithStamp(pastDue);
    runWrapper(home);
    await vi.waitFor(() => expect(Number(readStamp(home))).toBeGreaterThan(nowSeconds()), {
      timeout: UPKEEP_TIMEOUT_MS,
      interval: UPKEEP_POLL_MS,
    });
  });

  it("launches nothing before the stamp comes due", () => {
    const notDue = nowSeconds() + SECONDS_PER_HOUR;
    const home = homeWithStamp(notDue);
    runWrapper(home);
    expect(readStamp(home)).toBe(String(notDue));
  });

  it("leaves a home with no stamp to session start", () => {
    const home = homeWithStamp(undefined);
    runWrapper(home);
    expect(() => readStamp(home)).toThrow();
  });
});
