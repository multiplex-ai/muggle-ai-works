import { describe, expect, it } from "vitest";
import { findPastDatedYears } from "./past-dated-instruction";

const RUN_YEAR = 2026;

describe("findPastDatedYears", () => {
  it("reads a year written beside its month", () => {
    expect(findPastDatedYears("a stay from March 20-27, 2024, with parking", RUN_YEAR)).toEqual([
      2024,
    ]);
  });

  it("reads a year written as an ISO date", () => {
    expect(findPastDatedYears("repositories created after 2023-12-29", RUN_YEAR)).toEqual([2023]);
  });

  it("leaves a month and day carrying no year alone", () => {
    // "Dec. 26th" means the next one, which is how the person writing the task meant it.
    expect(findPastDatedYears("one-way flights on Dec. 26th", RUN_YEAR)).toEqual([]);
  });

  it("does not read a bare figure as a year", () => {
    expect(findPastDatedYears("repositories with 2024 stars", RUN_YEAR)).toEqual([]);
  });

  it("leaves a year still ahead alone", () => {
    expect(findPastDatedYears("a stay in March 2027", RUN_YEAR)).toEqual([]);
  });

  it("collapses a range that names the same year twice", () => {
    expect(
      findPastDatedYears("leaving on March 15, 2024, and returning on March 22, 2024", RUN_YEAR),
    ).toEqual([2024]);
  });
});
