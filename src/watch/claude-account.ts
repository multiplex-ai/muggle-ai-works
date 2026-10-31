import { readFileSync, statSync } from "fs";
import { optionalString } from "./field-parsers.js";
import type { ObservedClaudeLogin } from "./types.js";

/** Whether Claude's user settings connect every session to Remote Control as it starts; false when the file cannot be read. */
export function isRemoteControlAtStartup(claudeSettingsFile: string): boolean {
  try {
    const settings = JSON.parse(readFileSync(claudeSettingsFile, "utf-8")) as { remoteControlAtStartup?: unknown };
    return settings.remoteControlAtStartup === true;
  } catch {
    return false;
  }
}

/**
 * The claude.ai login Claude holds now: the account from its global config and
 * when its credentials file was last written. Either part is unset when it cannot be read.
 */
export function readClaudeLogin(claudeGlobalConfigFile: string, claudeCredentialsFile: string): ObservedClaudeLogin {
  let accountUuid: string | undefined;
  try {
    const config = JSON.parse(readFileSync(claudeGlobalConfigFile, "utf-8")) as { oauthAccount?: { accountUuid?: unknown } };
    accountUuid = optionalString(config.oauthAccount?.accountUuid);
  } catch {
    accountUuid = undefined;
  }
  let credentialsWrittenAtMs: number | undefined;
  try {
    credentialsWrittenAtMs = statSync(claudeCredentialsFile).mtimeMs;
  } catch {
    credentialsWrittenAtMs = undefined;
  }
  return { accountUuid: accountUuid, credentialsWrittenAtMs: credentialsWrittenAtMs };
}
