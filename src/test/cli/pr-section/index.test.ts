import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { buildPrSection, E2eReportSchema } from "../../../cli/pr-section/index.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
function load(name: string) {
  return E2eReportSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8")),
  );
}

describe("buildPrSection", () => {
  it("returns body and null comment for a report that fits the budget", () => {
    const result = buildPrSection(load("one-failed.json"), { maxBodyBytes: 60_000 });
    expect(result.body).toContain("## E2E Acceptance Results");
    expect(result.comment).toBeNull();
  });

  it("returns body and comment for a report that exceeds the budget", () => {
    const result = buildPrSection(load("oversized.json"), { maxBodyBytes: 1500 });
    expect(result.body).toContain("Full step-by-step evidence in the comment below");
    expect(result.comment).toContain("## E2E acceptance evidence (overflow)");
  });
});
