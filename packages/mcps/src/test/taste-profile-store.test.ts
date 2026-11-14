/** Tests for the local taste profile store and its budget check. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TASTE_SECTION_STATEMENT_CHARACTER_BUDGET } from "../shared/taste-profile/constants.js";
import { getTasteProfilePath } from "../shared/taste-profile/taste-paths.js";
import { findOverBudgetSections } from "../shared/taste-profile/taste-profile-budget.js";
import {
  clearTasteProfile,
  isTasteProfileEmpty,
  readTasteProfile,
  writeTasteProfileSections,
} from "../shared/taste-profile/taste-profile-store.js";
import { TasteCategory, type ITasteSection } from "../shared/taste-profile/types.js";
import { TasteProfileSetInputSchema } from "../mcp/local/contracts/taste-profile-schemas.js";

function buildSection(statement: string): ITasteSection {
  return {
    preferences: [
      { statement: statement, category: TasteCategory.Copy, signalCount: 2, lastSeenAt: "2026-11-01T00:00:00.000Z" },
    ],
    distilledAt: "2026-11-02T00:00:00.000Z",
  };
}

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "taste-store-"));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("taste profile store", () => {
  it("lives at taste/profile.json under the Muggle home directory", () => {
    expect(getTasteProfilePath(dataDir)).toBe(path.join(dataDir, "taste", "profile.json"));
  });

  it("reads an empty profile when none is stored or the file is corrupt", () => {
    expect(isTasteProfileEmpty(readTasteProfile(dataDir))).toBe(true);
    fs.mkdirSync(path.dirname(getTasteProfilePath(dataDir)), { recursive: true });
    fs.writeFileSync(getTasteProfilePath(dataDir), "{not json");
    expect(readTasteProfile(dataDir)).toEqual({ userSection: null, projectSections: {} });
  });

  it("replaces named sections and keeps the others", () => {
    writeTasteProfileSections({ userSection: buildSection("u1"), projectSections: { p1: buildSection("a") } }, dataDir);
    writeTasteProfileSections({ projectSections: { p2: buildSection("b") } }, dataDir);
    writeTasteProfileSections({ projectSections: { p1: buildSection("a2") } }, dataDir);

    const storedProfile = readTasteProfile(dataDir);
    expect(storedProfile.userSection).toEqual(buildSection("u1"));
    expect(storedProfile.projectSections).toEqual({ p1: buildSection("a2"), p2: buildSection("b") });
  });

  it("clears one project's section, or the whole profile", () => {
    writeTasteProfileSections({ userSection: buildSection("u"), projectSections: { p1: buildSection("a"), p2: buildSection("b") } }, dataDir);

    clearTasteProfile("p1", dataDir);
    expect(Object.keys(readTasteProfile(dataDir).projectSections)).toEqual(["p2"]);
    expect(readTasteProfile(dataDir).userSection).not.toBeNull();

    clearTasteProfile(undefined, dataDir);
    expect(fs.existsSync(getTasteProfilePath(dataDir))).toBe(false);
    expect(isTasteProfileEmpty(readTasteProfile(dataDir))).toBe(true);
  });
});

describe("taste section budget", () => {
  it("passes sections at the budget and names those over it", () => {
    const atBudget = buildSection("x".repeat(TASTE_SECTION_STATEMENT_CHARACTER_BUDGET));
    const overBudget = buildSection("x".repeat(TASTE_SECTION_STATEMENT_CHARACTER_BUDGET + 1));

    expect(findOverBudgetSections({ userSection: atBudget, projectSections: { p1: atBudget } })).toEqual([]);
    expect(findOverBudgetSections({ userSection: overBudget, projectSections: { p1: overBudget } })).toEqual([
      { sectionName: "user", statementCharacterCount: TASTE_SECTION_STATEMENT_CHARACTER_BUDGET + 1 },
      { sectionName: "p1", statementCharacterCount: TASTE_SECTION_STATEMENT_CHARACTER_BUDGET + 1 },
    ]);
  });
});

describe("TasteProfileSetInputSchema", () => {
  it("accepts a contract-shaped section", () => {
    expect(TasteProfileSetInputSchema.safeParse({ userSection: buildSection("ok") }).success).toBe(true);
  });

  it("rejects an empty update, an unknown category and a zero signal count", () => {
    expect(TasteProfileSetInputSchema.safeParse({}).success).toBe(false);
    const unknownCategory = { ...buildSection("x"), preferences: [{ ...buildSection("x").preferences[0], category: "Vibes" }] };
    expect(TasteProfileSetInputSchema.safeParse({ userSection: unknownCategory }).success).toBe(false);
    const zeroSignals = { ...buildSection("x"), preferences: [{ ...buildSection("x").preferences[0], signalCount: 0 }] };
    expect(TasteProfileSetInputSchema.safeParse({ userSection: zeroSignals }).success).toBe(false);
  });
});
