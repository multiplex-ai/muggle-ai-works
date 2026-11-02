import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fromRoot = (relativePath: string): string =>
  fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));

const readJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fromRoot(relativePath), "utf-8"));

// A declared licence with no text behind it is the state these assertions exist
// to keep out: package.json, every plugin manifest, and the shipped files must
// all name the same licence.
describe("the repository ships the licence it declares", () => {
  const licensePath = fromRoot("LICENSE");
  const noticePath = fromRoot("NOTICE");
  const pluginManifestPaths = [
    "plugin/.claude-plugin/plugin.json",
    "plugin/.cursor-plugin/plugin.json",
    "plugin/.codex-plugin/plugin.json",
  ];

  it("has LICENSE and NOTICE files at the root", () => {
    expect(existsSync(licensePath)).toBe(true);
    expect(existsSync(noticePath)).toBe(true);
  });

  it("carries the Apache 2.0 grant, not just the name", () => {
    const text = readFileSync(licensePath, "utf-8");
    expect(text).toContain("Apache License");
    expect(text).toContain("Version 2.0, January 2004");
    expect(text).toContain("Grant of Patent License");
  });

  it("matches the licence package.json and every plugin manifest declare", () => {
    expect(readJson("package.json").license).toBe("Apache-2.0");
    for (const manifestPath of pluginManifestPaths) {
      expect(readJson(manifestPath).license).toBe("Apache-2.0");
    }
  });

  // npm adds LICENSE to a tarball on its own but not NOTICE, and Apache 2.0
  // requires redistributions to carry it.
  it("ships NOTICE in the npm package", () => {
    expect(readJson("package.json").files).toContain("NOTICE");
  });

  // The holder is the marketplace owner rather than a name chosen here, so the
  // two cannot drift into naming different entities.
  it("names the same owner the marketplace manifest does", () => {
    const owner = (readJson(".claude-plugin/marketplace.json") as { owner: { name: string } }).owner;
    expect(readFileSync(noticePath, "utf-8")).toContain(`Copyright 2026 ${owner.name}`);
  });
});
