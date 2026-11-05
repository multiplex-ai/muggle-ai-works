import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { UPGRADE_AVAILABLE_PATH_SEGMENTS, UPGRADE_SKILL_NAMES } from "../../guardrails/constants.js";
import { isUpgradeReminderDue, readAvailableUpgrade, resolveUpgradeReminder } from "../../guardrails/upgradeReminder.js";

const SKILL_TOOL = "Skill";
const SKILL_EMIT_TOOL = "mcp__plugin_muggle_muggle__muggle-local-telemetry-skill-emit";
const CODEX_SKILL_EMIT_TOOL = "mcp__muggle__muggle_local_telemetry_skill_emit";

function homeWithRecordedUpgrade(recordedVersions: string): string {
  const home = mkdtempSync(join(tmpdir(), "upgrade-reminder-"));
  const upgradeFile = join(home, ...UPGRADE_AVAILABLE_PATH_SEGMENTS);
  mkdirSync(dirname(upgradeFile), { recursive: true });
  writeFileSync(upgradeFile, recordedVersions);
  return home;
}

function writeUserPreferences(home: string, preferences: Record<string, string>): void {
  mkdirSync(join(home, ".muggle-ai"), { recursive: true });
  writeFileSync(join(home, ".muggle-ai", "preferences.json"), JSON.stringify({ preferences: preferences }));
}

describe("readAvailableUpgrade", () => {
  it("reads the installed and latest versions the upkeep recorded", () => {
    expect(readAvailableUpgrade(homeWithRecordedUpgrade("5.32.0|5.33.0"))).toEqual({
      installedVersion: "5.32.0",
      latestVersion: "5.33.0",
    });
  });

  it("is undefined when no upgrade is recorded", () => {
    expect(readAvailableUpgrade(mkdtempSync(join(tmpdir(), "upgrade-reminder-")))).toBeUndefined();
  });

  it.each(["", "5.32.0", "5.32.0|", "|5.33.0", "5.32.0|5.33.0|5.34.0"])("rejects the malformed record %j", (recorded) => {
    expect(readAvailableUpgrade(homeWithRecordedUpgrade(recorded))).toBeUndefined();
  });
});

describe("isUpgradeReminderDue", () => {
  it("reminds on a Skill call, even repeating the last skill", () => {
    expect(
      isUpgradeReminderDue({ skillName: "muggle-test", toolName: SKILL_TOOL, previousSkillName: "muggle-test" }),
    ).toBe(true);
  });

  it.each([SKILL_EMIT_TOOL, CODEX_SKILL_EMIT_TOOL])("stays silent on the %s emit that follows its Skill call", (toolName) => {
    expect(isUpgradeReminderDue({ skillName: "muggle-test", toolName: toolName, previousSkillName: "muggle-test" })).toBe(
      false,
    );
  });

  it("reminds on an emit no Skill call announced, as a typed slash command produces", () => {
    expect(
      isUpgradeReminderDue({ skillName: "muggle-test", toolName: SKILL_EMIT_TOOL, previousSkillName: "muggle-status" }),
    ).toBe(true);
    expect(
      isUpgradeReminderDue({ skillName: "muggle-test", toolName: SKILL_EMIT_TOOL, previousSkillName: undefined }),
    ).toBe(true);
  });

  it.each(UPGRADE_SKILL_NAMES)("never reminds inside %s", (skillName) => {
    expect(isUpgradeReminderDue({ skillName: skillName, toolName: SKILL_TOOL, previousSkillName: undefined })).toBe(false);
  });
});

describe("resolveUpgradeReminder", () => {
  const announcement = { skillName: "muggle-test", toolName: SKILL_TOOL, previousSkillName: undefined };

  it("names both versions and the upgrade command", () => {
    const reminder = resolveUpgradeReminder(announcement, homeWithRecordedUpgrade("5.32.0|5.33.0"));
    expect(reminder).toContain("5.32.0 → 5.33.0");
    expect(reminder).toContain("/muggle:muggle-upgrade");
  });

  it("is undefined when no upgrade is available", () => {
    expect(resolveUpgradeReminder(announcement, mkdtempSync(join(tmpdir(), "upgrade-reminder-")))).toBeUndefined();
  });

  it("is undefined under checkForUpdates=never", () => {
    const home = homeWithRecordedUpgrade("5.32.0|5.33.0");
    writeUserPreferences(home, { checkForUpdates: "never" });
    expect(resolveUpgradeReminder(announcement, home)).toBeUndefined();
  });

  it("still reminds under checkForUpdates=ask, since a reminder asks nothing", () => {
    const home = homeWithRecordedUpgrade("5.32.0|5.33.0");
    writeUserPreferences(home, { checkForUpdates: "ask" });
    expect(resolveUpgradeReminder(announcement, home)).toContain("5.33.0");
  });
});
