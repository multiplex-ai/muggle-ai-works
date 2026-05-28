import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let dataDir: string;
let homeDir: string;

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return { ...actual, homedir: vi.fn(() => homeDir) };
});

vi.mock("../../../packages/mcps/src/index.js", () => ({
  getDataDir: vi.fn(() => dataDir),
  getElectronAppVersion: vi.fn(() => "1.0.5"),
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

import { listObsoleteSkills, cleanupObsoleteSkills, cleanupCommand } from "../../cli/cleanup.js";

function makeSkill(name: string): void {
  const dir = join(homeDir, ".cursor", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "x".repeat(64));
}

function writeManifest(skills: string[]): void {
  writeFileSync(join(dataDir, "install-manifest.json"), JSON.stringify({ skills }));
}

describe("obsolete skills", () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "mgl-data-"));
    homeDir = mkdtempSync(join(tmpdir(), "mgl-home-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("flags muggle-prefixed and alias skills missing from the manifest", () => {
    makeSkill("muggle-test");
    makeSkill("mtest");
    makeSkill("unrelated-skill");
    writeManifest(["muggle-test"]);

    const obsolete = listObsoleteSkills();
    const names = obsolete.map((s) => s.name).sort();
    expect(names).toEqual(["mtest"]);
  });

  it("returns empty when no manifest and no skills dir", () => {
    expect(listObsoleteSkills()).toEqual([]);
  });

  it("treats all matching skills as obsolete when manifest is absent", () => {
    makeSkill("muggle-do");
    makeSkill("mpr");
    const obsolete = listObsoleteSkills();
    expect(obsolete.map((s) => s.name).sort()).toEqual(["mpr", "muggle-do"]);
  });

  it("removes obsolete skills and reports freed bytes", () => {
    makeSkill("muggle-old");
    writeManifest([]);

    const result = cleanupObsoleteSkills();
    expect(result.removed.map((s) => s.name)).toEqual(["muggle-old"]);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(existsSync(join(homeDir, ".cursor", "skills", "muggle-old"))).toBe(false);
  });

  it("dry run leaves skills on disk", () => {
    makeSkill("muggle-old");
    writeManifest([]);

    const result = cleanupObsoleteSkills({ dryRun: true });
    expect(result.removed).toHaveLength(1);
    expect(existsSync(join(homeDir, ".cursor", "skills", "muggle-old"))).toBe(true);
  });

  it("cleanupCommand --skills lists and removes obsolete skills", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    makeSkill("muggle-old");
    writeManifest([]);

    return cleanupCommand({ skills: true }).then(() => {
      const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(out).toContain("obsolete skill(s)");
      expect(out).toContain("muggle-old");
      expect(existsSync(join(homeDir, ".cursor", "skills", "muggle-old"))).toBe(false);
      logSpy.mockRestore();
    });
  });

  it("cleanupCommand --skills with dry run reports would-remove and keeps skills", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    makeSkill("muggle-keep");
    writeManifest([]);

    return cleanupCommand({ skills: true, dryRun: true }).then(() => {
      const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(out).toContain("Would remove:");
      expect(existsSync(join(homeDir, ".cursor", "skills", "muggle-keep"))).toBe(true);
      logSpy.mockRestore();
    });
  });
});
