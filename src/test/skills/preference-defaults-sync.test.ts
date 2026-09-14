import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_PREFERENCES } from "../../../packages/mcps/src/index.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const shippedDefaultsPath = join(repositoryRoot, "plugin", "config", "preference-defaults.json");

describe("shipped preference defaults", () => {
  const shipped = JSON.parse(readFileSync(shippedDefaultsPath, "utf-8")) as Record<string, string>;

  it("matches DEFAULT_PREFERENCES exactly", () => {
    expect(shipped).toEqual(DEFAULT_PREFERENCES);
  });

  it("covers every key, so the SessionStart hook resolves what the MCP tools resolve", () => {
    expect(Object.keys(shipped).sort()).toEqual(Object.keys(DEFAULT_PREFERENCES).sort());
  });
});
