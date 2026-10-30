import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { lastSeenEntryFor, parseWatchDueRecord, readSlotPr } from "../../pr-watch/slotFiles.js";
import {
  resolvePreferenceValue,
  resolveUserPreferenceValue,
  resolveWatchPreferences,
} from "../../pr-watch/watchPreferences.js";

describe("parseWatchDueRecord", () => {
  it("reads the record pr-watch-due.sh writes, CRLF included", () => {
    expect(parseWatchDueRecord('HEAD="h1"\r\nREBASE_DUE="h1..b1"\r\nCI_RED_HEAD=""\r\n')).toEqual({
      headSha: "h1",
      rebaseDueKey: "h1..b1",
      ciRedHeadSha: "",
    });
  });

  it("reads an empty file, or one with nothing due, as no record", () => {
    expect(parseWatchDueRecord("")).toBeNull();
    expect(parseWatchDueRecord('HEAD="h1"\nREBASE_DUE=""\nCI_RED_HEAD=""\n')).toBeNull();
  });
});

describe("lastSeenEntryFor", () => {
  it("returns the PR's own entry", () => {
    const lastSeen = JSON.stringify({ "o/r#1": { catch_up_rebases: 2 }, "o/r#2": { catch_up_rebases: 9 } });
    expect(lastSeenEntryFor(lastSeen, "o/r#1")).toEqual({ catch_up_rebases: 2 });
  });

  it("reads malformed or absent state as nothing recorded", () => {
    expect(lastSeenEntryFor('{"o/r#1": {', "o/r#1")).toEqual({});
    expect(lastSeenEntryFor("", "o/r#1")).toEqual({});
    expect(lastSeenEntryFor(JSON.stringify({ "o/r#1": [1] }), "o/r#1")).toEqual({});
  });
});

describe("readSlotPr", () => {
  const slotWith = (prsJson: string): string => {
    const slot = mkdtempSync(join(tmpdir(), "pr-watch-slot-"));
    writeFileSync(join(slot, "prs.json"), prsJson);
    return slot;
  };

  it("reads the first entry of the array, and a pre-array object", () => {
    expect(readSlotPr(slotWith(JSON.stringify([{ number: 4, url: "u" }])))).toEqual({ number: 4, url: "u" });
    expect(readSlotPr(slotWith(JSON.stringify({ number: 5 })))).toEqual({ number: 5 });
  });

  it("is undefined for a slot with no readable PR", () => {
    expect(readSlotPr(slotWith("not json"))).toBeUndefined();
    expect(readSlotPr(slotWith("[]"))).toBeUndefined();
    expect(readSlotPr(mkdtempSync(join(tmpdir(), "pr-watch-slot-")))).toBeUndefined();
  });
});

describe("resolveWatchPreferences", () => {
  const homeAndPlugin = (userPreferences: unknown, shippedDefaults: unknown): [string, string] => {
    const root = mkdtempSync(join(tmpdir(), "pr-watch-prefs-"));
    const home = join(root, "home");
    const plugin = join(root, "plugin");
    mkdirSync(join(home, ".muggle-ai"), { recursive: true });
    mkdirSync(join(plugin, "config"), { recursive: true });
    if (userPreferences !== undefined) {
      writeFileSync(join(home, ".muggle-ai", "preferences.json"), JSON.stringify({ preferences: userPreferences }));
    }
    writeFileSync(join(plugin, "config", "preference-defaults.json"), JSON.stringify(shippedDefaults));
    return [home, plugin];
  };

  it("lets the user's value win over the shipped default", () => {
    const [home, plugin] = homeAndPlugin({ autoRebase: "never", maxCatchUpRebases: "5" }, { autoRebase: "always", maxCatchUpRebases: "20" });
    expect(resolveWatchPreferences(home, plugin)).toEqual({ autoRebase: "never", maxCatchUpRebases: 5 });
  });

  it("falls back to the defaults with no user file, and on an invalid cap", () => {
    const [home, plugin] = homeAndPlugin(undefined, { autoRebase: "always", maxCatchUpRebases: "20" });
    expect(resolveWatchPreferences(home, plugin)).toEqual({ autoRebase: "always", maxCatchUpRebases: 20 });
    const [invalidHome, invalidPlugin] = homeAndPlugin({ maxCatchUpRebases: "-3" }, { maxCatchUpRebases: "20" });
    expect(resolveWatchPreferences(invalidHome, invalidPlugin).maxCatchUpRebases).toBe(20);
  });

  it("reads never as unbounded", () => {
    const [home, plugin] = homeAndPlugin({ maxCatchUpRebases: "never" }, { maxCatchUpRebases: "20" });
    expect(resolveWatchPreferences(home, plugin).maxCatchUpRebases).toBeNull();
  });

  it("reads the watcher lifetime as seconds, never as unbounded, and an unknown value as no override", () => {
    const lifetimeOf = (userValue: unknown): number | undefined =>
      resolveWatchPreferences(...homeAndPlugin({ watcherLifetime: userValue }, { watcherLifetime: "7d" })).watcherLifetimeSeconds;
    expect(lifetimeOf("1d")).toBe(86_400);
    expect(lifetimeOf("never")).toBe(0);
    expect(lifetimeOf("3w")).toBe(604_800);
    expect(resolveWatchPreferences(...homeAndPlugin(undefined, {})).watcherLifetimeSeconds).toBeUndefined();
  });

  it("matches the shipped defaults", () => {
    const pluginRoot = fileURLToPath(new URL("../../../plugin", import.meta.url));
    expect(resolveWatchPreferences(mkdtempSync(join(tmpdir(), "pr-watch-home-")), pluginRoot)).toEqual({
      autoRebase: "always",
      maxCatchUpRebases: 20,
      watcherLifetimeSeconds: 604_800,
    });
  });

  it("resolves any one preference the same way: the user's string over the default, a null falling through", () => {
    const [home, plugin] = homeAndPlugin(
      { autoE2ETest: "ask", postPRVisualWalkthrough: null },
      { autoE2ETest: "always", postPRVisualWalkthrough: "always" },
    );
    expect(resolvePreferenceValue("autoE2ETest", home, plugin)).toBe("ask");
    expect(resolvePreferenceValue("postPRVisualWalkthrough", home, plugin)).toBe("always");
    expect(resolvePreferenceValue("unknownPreference", home, plugin)).toBeUndefined();
  });

  it("reads only the user's own file for an explicit choice, never the shipped default", () => {
    const [home] = homeAndPlugin({ autoE2ETest: "always" }, { postPRVisualWalkthrough: "always" });
    expect(resolveUserPreferenceValue("autoE2ETest", home)).toBe("always");
    expect(resolveUserPreferenceValue("postPRVisualWalkthrough", home)).toBeUndefined();
  });
});
