import { describe, it, expect } from "vitest";

import { E2E_RESULT_MARKER_PREFIX } from "../../e2e-result/constants";
import { latestE2eResult, parseE2eResultMarker, renderE2eResultMarker } from "../../e2e-result/marker";
import { UnpassedCaseStatus, type IE2eResultRecord } from "../../e2e-result/types";

const failing: IE2eResultRecord = {
  total: 2,
  passed: 1,
  unpassed: [
    {
      name: "Checkout",
      testCaseId: "tc-2",
      status: UnpassedCaseStatus.Failed,
      failedStep: 4,
      detail: "Pay button disabled",
      viewUrl: "https://www.muggle-ai.com/run/2",
    },
  ],
};

const passing: IE2eResultRecord = { total: 2, passed: 2, unpassed: [] };

describe("E2E result marker", () => {
  it("round-trips a record through a comment body", () => {
    const body = `intro\n${renderE2eResultMarker(failing)}\n## E2E Acceptance Results`;
    expect(parseE2eResultMarker(body)).toEqual(failing);
  });

  it("keeps an error holding --> inside the hidden comment", () => {
    const hostile: IE2eResultRecord = {
      ...failing,
      unpassed: [{ ...failing.unpassed[0], detail: "expected <b> --> got </b>" }],
    };
    const marker = renderE2eResultMarker(hostile);
    expect(marker.indexOf("-->")).toBe(marker.length - "-->".length);
    expect(parseE2eResultMarker(marker)?.unpassed[0].detail).toBe("expected <b> --> got </b>");
  });

  it("returns null for a body without a marker, or with one that does not parse", () => {
    expect(parseE2eResultMarker("### Muggle E2E\n3 passed")).toBeNull();
    expect(parseE2eResultMarker(`${E2E_RESULT_MARKER_PREFIX}{not json} -->`)).toBeNull();
    expect(parseE2eResultMarker(`${E2E_RESULT_MARKER_PREFIX}{"total":1} -->`)).toBeNull();
  });

  it("takes the newest comment carrying a record, so a re-run supersedes the old walkthrough", () => {
    const bodies = [renderE2eResultMarker(failing), "lgtm", renderE2eResultMarker(passing), "thanks"];
    expect(latestE2eResult(bodies)).toEqual(passing);
    expect(latestE2eResult(["lgtm"])).toBeNull();
  });
});
