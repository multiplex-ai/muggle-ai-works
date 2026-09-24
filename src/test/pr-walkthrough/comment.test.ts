import { describe, it, expect } from "vitest";
import {
  classifyComment,
  renderReservedComment,
  renderSkippedComment,
  renderUnreasonedSkipComment,
  walkthroughVerdict,
} from "../../pr-walkthrough/comment";
import { E2eSkipCode } from "../../e2e-skip/types";
import { REPORT_SENTINEL, WALKTHROUGH_SLOT_MARKER } from "../../pr-walkthrough/constants";
import { WalkthroughCommentStatus, WalkthroughVerdict } from "../../pr-walkthrough/types";

const reported = `${WALKTHROUGH_SLOT_MARKER}\n<!-- muggle-pr-section:v1 -->\n### Muggle E2E\n3 passed`;

describe("renderReservedComment", () => {
  it("carries the slot marker but never the report sentinel", () => {
    const body = renderReservedComment();
    expect(body).toContain(WALKTHROUGH_SLOT_MARKER);
    expect(body).not.toContain(REPORT_SENTINEL);
  });

  it("classifies as pending", () => {
    expect(classifyComment(renderReservedComment())).toBe(WalkthroughCommentStatus.Pending);
  });
});

describe("renderSkippedComment", () => {
  it("names the verified code and what it claims", () => {
    const body = renderSkippedComment(E2eSkipCode.NoWebSurface, "ships hooks and a CLI");
    expect(body).toContain("NO_WEB_SURFACE");
    expect(body).toContain("ships hooks and a CLI");
    expect(classifyComment(body)).toBe(WalkthroughCommentStatus.Skipped);
  });

  it("settles on the code alone when no detail was given", () => {
    expect(classifyComment(renderSkippedComment(E2eSkipCode.NoPr, "  "))).toBe(
      WalkthroughCommentStatus.Skipped,
    );
  });

  // The rendering takes a code, so there is nowhere to put another tool's
  // findings — which is what keeps this heading off a run that never happened.
  it("states plainly that no run happened", () => {
    expect(renderSkippedComment(E2eSkipCode.EmptyDiff, "")).toContain("No E2E run");
  });
});

describe("renderUnreasonedSkipComment", () => {
  it("settles the slot while saying no verified reason was given", () => {
    const body = renderUnreasonedSkipComment();
    expect(body).toContain("no verified reason given");
    expect(classifyComment(body)).toBe(WalkthroughCommentStatus.Skipped);
  });
});

describe("classifyComment", () => {
  it("reads a rendered walkthrough as reported", () => {
    expect(classifyComment(reported)).toBe(WalkthroughCommentStatus.Reported);
  });

  it("ignores a comment that is not the designated slot", () => {
    expect(classifyComment("looks good to me")).toBe(WalkthroughCommentStatus.NotDesignated);
  });

  it("reads a report as reported even without the slot marker, so walkthroughs posted before this guard still count", () => {
    expect(classifyComment("<!-- muggle-pr-section:v1 -->\n2 passed")).toBe(
      WalkthroughCommentStatus.Reported,
    );
  });
});

describe("walkthroughVerdict", () => {
  it("is missing when no comment is designated", () => {
    expect(walkthroughVerdict(["ship it"])).toBe(WalkthroughVerdict.Missing);
  });

  it("is pending while the slot is reserved and empty", () => {
    expect(walkthroughVerdict([renderReservedComment()])).toBe(WalkthroughVerdict.Pending);
  });

  it("is satisfied once a walkthrough lands in the slot", () => {
    expect(walkthroughVerdict([renderReservedComment(), reported])).toBe(
      WalkthroughVerdict.Satisfied,
    );
  });

  it("is satisfied by a skip that cites a verified code", () => {
    expect(walkthroughVerdict([renderSkippedComment(E2eSkipCode.NoWebSurface, "")])).toBe(
      WalkthroughVerdict.Satisfied,
    );
  });
});
