import { describe, it, expect } from "vitest";
import {
  classifyComment,
  renderReservedComment,
  renderSkippedComment,
  walkthroughVerdict,
} from "../../pr-walkthrough/comment";
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
  it("shows the reason to reviewers", () => {
    const body = renderSkippedComment("no browser surface in this change");
    expect(body).toContain("no browser surface in this change");
    expect(classifyComment(body)).toBe(WalkthroughCommentStatus.Skipped);
  });

  it("stays pending when the reason is blank, so an empty skip cannot settle the slot", () => {
    expect(classifyComment(renderSkippedComment("   "))).toBe(WalkthroughCommentStatus.Pending);
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

  it("is satisfied by a skip that states a reason", () => {
    expect(walkthroughVerdict([renderSkippedComment("docs-only change")])).toBe(
      WalkthroughVerdict.Satisfied,
    );
  });
});
