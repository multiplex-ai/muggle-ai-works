import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fromRoot = (relativePath: string): string =>
  fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));

const readJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fromRoot(relativePath), "utf-8"));

// package.json claimed MIT and the README called the repo open source while no
// LICENSE file existed, so the badge and the licence reference both pointed at
// nothing. A declared licence with no text is the state these assertions exist
// to keep out.
describe("the repository ships the licence it declares", () => {
  const licensePath = fromRoot("LICENSE");

  it("has a LICENSE file at the root", () => {
    expect(existsSync(licensePath)).toBe(true);
  });

  it("carries the MIT grant, not just the name", () => {
    const text = readFileSync(licensePath, "utf-8");
    expect(text).toContain("MIT License");
    expect(text).toContain("Permission is hereby granted, free of charge");
    expect(text).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  });

  it("matches the licence package.json declares", () => {
    expect(readJson("package.json").license).toBe("MIT");
  });

  // The holder is the marketplace owner rather than a name chosen here, so the
  // two cannot drift into naming different entities.
  it("names the same owner the marketplace manifest does", () => {
    const owner = (readJson(".claude-plugin/marketplace.json") as { owner: { name: string } }).owner;
    expect(readFileSync(licensePath, "utf-8")).toContain(`Copyright (c) 2026 ${owner.name}`);
  });
});
