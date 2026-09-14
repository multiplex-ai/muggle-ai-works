import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Import the leaf module, not the package barrel — the rule preference-gates-lint.test.ts documents.
import { DEFAULT_PREFERENCES } from "../../../packages/mcps/src/shared/preferences-constants.js";
import { ONBOARDING_MAX_OFFERS } from "../../../packages/mcps/src/shared/onboarding/onboarding-constants.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const shippedDefaultsPath = join(repositoryRoot, "plugin", "config", "preference-defaults.json");
const shippedLimitsPath = join(repositoryRoot, "plugin", "config", "onboarding-limits.json");

describe("shipped preference defaults", () => {
  const shipped = JSON.parse(readFileSync(shippedDefaultsPath, "utf-8")) as Record<string, string>;

  it("matches DEFAULT_PREFERENCES exactly", () => {
    expect(shipped).toEqual(DEFAULT_PREFERENCES);
  });

  it("covers every key, so the SessionStart hook resolves what the MCP tools resolve", () => {
    expect(Object.keys(shipped).sort()).toEqual(Object.keys(DEFAULT_PREFERENCES).sort());
  });
});

describe("shipped onboarding limits", () => {
  const shipped = JSON.parse(readFileSync(shippedLimitsPath, "utf-8")) as { maxOffers: number };

  it("matches ONBOARDING_MAX_OFFERS, so the hook retires the offer when the service would", () => {
    expect(shipped.maxOffers).toBe(ONBOARDING_MAX_OFFERS);
  });
});
