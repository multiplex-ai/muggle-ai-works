import { mkdirSync, utimesSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { isRemoteControlAtStartup, readClaudeLogin } from "../../watch/claude-account.js";
import { makeTempDir } from "./fixtures.js";

describe("isRemoteControlAtStartup", () => {
  it("is true only when the user settings turn it on", () => {
    const root = makeTempDir("claude-settings");
    const settingsFile = join(root, "settings.json");
    expect(isRemoteControlAtStartup(settingsFile)).toBe(false);
    writeFileSync(settingsFile, "{");
    expect(isRemoteControlAtStartup(settingsFile)).toBe(false);
    writeFileSync(settingsFile, JSON.stringify({ remoteControlAtStartup: "true" }));
    expect(isRemoteControlAtStartup(settingsFile)).toBe(false);
    writeFileSync(settingsFile, JSON.stringify({ remoteControlAtStartup: true }));
    expect(isRemoteControlAtStartup(settingsFile)).toBe(true);
  });
});

describe("readClaudeLogin", () => {
  it("reads the account and when the credentials were last written", () => {
    const root = makeTempDir("claude-login");
    const configFile = join(root, ".claude.json");
    const credentialsFile = join(root, "claude", ".credentials.json");
    writeFileSync(configFile, JSON.stringify({ oauthAccount: { accountUuid: "93d6918c", emailAddress: "a@b.c" } }));
    mkdirSync(join(root, "claude"));
    writeFileSync(credentialsFile, "{}");
    utimesSync(credentialsFile, 1_700_000_000, 1_700_000_000);
    expect(readClaudeLogin(configFile, credentialsFile)).toEqual({ accountUuid: "93d6918c", credentialsWrittenAtMs: 1_700_000_000_000 });
  });

  it("leaves out what it cannot read", () => {
    const root = makeTempDir("claude-login");
    const configFile = join(root, ".claude.json");
    writeFileSync(configFile, JSON.stringify({ oauthAccount: {} }));
    expect(readClaudeLogin(configFile, join(root, "missing.json"))).toEqual({});
    expect(readClaudeLogin(join(root, "absent.json"), join(root, "missing.json"))).toEqual({});
  });
});
