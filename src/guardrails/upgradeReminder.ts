import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { UNBOUNDED_PREFERENCE_VALUE } from "../pr-watch/constants.js";
import { resolvePreferenceValue } from "../pr-watch/watchPreferences.js";
import {
  CHECK_FOR_UPDATES_PREFERENCE_KEY,
  MUGGLE_SKILL_EMIT_TOOL,
  UPGRADE_AVAILABLE_PATH_SEGMENTS,
  UPGRADE_SKILL_NAMES,
} from "./constants.js";
import type { AvailableUpgrade, SkillAnnouncement } from "./types.js";

/**
 * The upgrade session-maintenance.sh recorded, or undefined when the file is absent or malformed.
 *
 * Output shape: `{ installedVersion: "5.32.0", latestVersion: "5.33.0" }`
 */
export function readAvailableUpgrade(homeDir: string = homedir()): AvailableUpgrade | undefined {
  let recordedVersions: string;
  try {
    recordedVersions = readFileSync(join(homeDir, ...UPGRADE_AVAILABLE_PATH_SEGMENTS), "utf-8").trim();
  } catch {
    return undefined;
  }
  const [installedVersion, latestVersion, ...extraFields] = recordedVersions.split("|");
  if (!installedVersion || !latestVersion || extraFields.length > 0) return undefined;
  return { installedVersion: installedVersion, latestVersion: latestVersion };
}

/**
 * Whether this firing is the one that reminds for its skill invocation.
 *
 * A skill reaches the hook twice, through the Skill tool and then its own telemetry emit, while a typed slash command
 * reaches it through the emit alone. So an emit reminds unless the skill it names was the one just recorded.
 */
export function isUpgradeReminderDue(announcement: SkillAnnouncement): boolean {
  if ((UPGRADE_SKILL_NAMES as readonly string[]).includes(announcement.skillName)) return false;
  const isTelemetryEmit = MUGGLE_SKILL_EMIT_TOOL.test(announcement.toolName ?? "");
  return !isTelemetryEmit || announcement.previousSkillName !== announcement.skillName;
}

/** The reminder for this skill firing, or undefined when none is due, none is available, or the user turned it off. */
export function resolveUpgradeReminder(
  announcement: SkillAnnouncement,
  homeDir: string = homedir(),
): string | undefined {
  if (!isUpgradeReminderDue(announcement)) return undefined;
  const availableUpgrade = readAvailableUpgrade(homeDir);
  if (!availableUpgrade) return undefined;
  if (resolvePreferenceValue(CHECK_FOR_UPDATES_PREFERENCE_KEY, homeDir) === UNBOUNDED_PREFERENCE_VALUE) return undefined;
  return (
    `A newer @muggleai/works is available (${availableUpgrade.installedVersion} → ${availableUpgrade.latestVersion}). ` +
    `Tell the user to run \`/muggle:muggle-upgrade\` to update.`
  );
}
