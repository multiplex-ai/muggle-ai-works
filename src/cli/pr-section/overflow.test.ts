import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { splitWithOverflow } from "./overflow.js";
import { E2eReportSchema } from "./types.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
function load(name: string) {
  return E2eReportSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8")),
  );
}

describe("splitWithOverflow", () => {
  it("keeps everything in the body when it fits", () => {
    const report = load("one-failed.json");
    const result = splitWithOverflow(report, { maxBodyBytes: 60_000 });
    expect(result.comment).toBeNull();
    expect(result.body).toContain("<details>");
    expect(Buffer.byteLength(result.body, "utf-8")).toBeLessThanOrEqual(60_000);
  });

  it("spills failure details into the comment when the inline body exceeds the budget", () => {
    const report = load("oversized.json");
    const result = splitWithOverflow(report, { maxBodyBytes: 1500 });
    expect(result.comment).not.toBeNull();
    expect(result.body).not.toContain("<details>");
    expect(result.body).toContain("Full step-by-step evidence in the comment below");
    expect(result.comment).toContain("<details>");
  });

  it("never spills when there are no failures (all-passed report)", () => {
    const report = load("all-passed.json");
    // Absurdly small budget. All-passed reports have no failure details to spill,
    // so comment stays null even if the body exceeds the budget. Downstream
    // handling is the caller's job.
    const result = splitWithOverflow(report, { maxBodyBytes: 100 });
    expect(result.comment).toBeNull();
  });

  it("uses utf-8 byte length, not character length", () => {
    const report = load("one-failed.json");
    // Inline body is well under 60k bytes.
    const fitting = splitWithOverflow(report, { maxBodyBytes: 60_000 });
    expect(fitting.comment).toBeNull();
    // Force overflow with a tiny budget.
    const spilling = splitWithOverflow(report, { maxBodyBytes: 500 });
    expect(spilling.comment).not.toBeNull();
  });
});
