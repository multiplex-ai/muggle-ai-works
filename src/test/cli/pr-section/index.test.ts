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
    expect(result.body).toContain("<details>");
    expect(result.comment).toBeNull();
  });

  it("returns body and comment for a report that exceeds the budget", () => {
    const result = buildPrSection(load("oversized.json"), { maxBodyBytes: 300 });
    expect(result.body).toContain("Full per-test details in the comment below");
    expect(result.comment).toContain("## E2E acceptance evidence (overflow)");
  });

  it("keeps the overview section in the body even when details are spilled", () => {
    const result = buildPrSection(load("grouped-by-use-case.json"), { maxBodyBytes: 500 });
    expect(result.body).toContain("## E2E Acceptance Results");
    expect(result.body).toContain("**3 tests ran — 2 passed / 1 failed**");
    expect(result.body).toContain("- **Create a New Project**");
    expect(result.body).not.toContain("<details>");
    expect(result.comment).toContain("<details>");
  });
});
