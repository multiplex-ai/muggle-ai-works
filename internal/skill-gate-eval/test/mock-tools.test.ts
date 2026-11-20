import { describe, it, expect } from "vitest";
import { DEFAULT_TEST_CASE_ANCESTORS } from "../src/constants.js";
import { mockToolSpecs } from "../src/mock-tools.js";
import type { Fixtures } from "../src/types.js";

const ANCESTORS_TOOL = "muggle-remote-test-case-ancestors-get";

function ancestorsReply(fixtures: Fixtures): unknown {
  return mockToolSpecs(fixtures).find((spec) => spec.name === ANCESTORS_TOOL)?.reply();
}

describe("the prerequisite-chain lookup a skill makes before a run", () => {
  // An orphan reads as "prerequisites unknown", which tells the skill not to run the case.
  it("answers that the case is a graph root with no prerequisites", () => {
    expect(ancestorsReply({})).toEqual({ testCaseId: "tc-stub", ancestors: [], orphan: false });
    expect(DEFAULT_TEST_CASE_ANCESTORS.orphan).toBe(false);
  });

  it("names the scenario's own test case", () => {
    expect(ancestorsReply({ testCase: { id: "tc-stub-1", title: "Successful signup" } })).toEqual({
      testCaseId: "tc-stub-1",
      ancestors: [],
      orphan: false,
    });
  });

  it("answers with the chain a scenario scripts", () => {
    const scripted = { testCaseId: "tc-2", ancestors: ["tc-1"], orphan: false };
    expect(ancestorsReply({ testCaseAncestors: scripted })).toEqual(scripted);
  });
});
