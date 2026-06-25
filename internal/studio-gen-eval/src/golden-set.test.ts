import { describe, expect, it } from "vitest";

import { bodyHash, detectDrift } from "./golden-set.js";
import { type GoldenCase, type GoldenSet } from "./types.js";

function gcase (over: Partial<GoldenCase> = {}): GoldenCase {
  const base = {
    testCaseId: "tc-1",
    useCaseId: "uc-1",
    projectId: "proj-1",
    title: "Login",
    url: "https://app.example.com",
    goal: "log in",
    precondition: "registered user",
    instructions: "enter creds and submit",
    expectedResult: "dashboard shown",
  };
  const merged = { ...base, ...over };
  return { ...merged, bodyHash: bodyHash(merged) };
}

describe("bodyHash", () => {
  it("is stable for the same generation-relevant fields and ignores whitespace", () => {
    expect(bodyHash(gcase())).toBe(bodyHash(gcase({ instructions: "  enter creds and submit  " })));
  });

  it("changes when a generation-relevant field changes", () => {
    expect(bodyHash(gcase())).not.toBe(bodyHash(gcase({ goal: "log in fast" })));
  });

  it("ignores fields that don't drive generation (e.g. title)", () => {
    expect(bodyHash(gcase())).toBe(bodyHash(gcase({ title: "Sign in" })));
  });
});

describe("detectDrift", () => {
  const set: GoldenSet = { sourceProjectId: "proj-1", importedAt: "t", cases: [gcase(), gcase({ testCaseId: "tc-2", goal: "checkout" })] };

  it("flags only cases whose live hash differs from the snapshot", () => {
    const live = new Map([
      ["tc-1", set.cases[0].bodyHash],
      ["tc-2", "deadbeef"],
    ]);
    expect(detectDrift(set, live).map((c) => c.testCaseId)).toEqual(["tc-2"]);
  });

  it("skips cases absent from the live map (unknown, not drifted)", () => {
    expect(detectDrift(set, new Map())).toEqual([]);
  });
});
