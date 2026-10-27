import { describe, it, expect } from "vitest";
import {
  classifyComment,
  lastFullRunOf,
  renderDependencyBotComment,
  renderNoAppLogicChangeComment,
  renderReservedComment,
  renderSkippedComment,
  renderUnreasonedSkipComment,
  walkthroughVerdict,
  withoutRerunNotice,
  withRerunNotice,
} from "../../pr-walkthrough/comment";
import { E2eSkipCode } from "../../e2e-skip/types";
import { REPORT_SENTINEL, WALKTHROUGH_SLOT_MARKER } from "../../pr-walkthrough/constants";
import { WalkthroughCommentStatus, WalkthroughVerdict } from "../../pr-walkthrough/types";

const reported = `${WALKTHROUGH_SLOT_MARKER}\n<!-- muggle-pr-section:v1 -->\n### Muggle E2E\n3 passed`;
const builderReport = "<!-- muggle-pr-section:v1 -->\n## E2E Acceptance Results\n\n**✅ PASS** — 3 tests ran";
const PRE_CYCLE = { preCycleSha: "1a2b3c4d5e6f", reason: "README typo" };
const HEAD_SHA = "9f8e7d6c5b4a39281706f5e4d3c2b1a098f7e6d5";

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

describe("renderDependencyBotComment", () => {
  it("names the bot and settles the slot", () => {
    const body = renderDependencyBotComment("dependabot[bot]");
    expect(body).toContain("`dependabot[bot]`");
    expect(classifyComment(body)).toBe(WalkthroughCommentStatus.Skipped);
  });
});

describe("renderSkippedComment", () => {
  it("names the verified code and what it claims", () => {
    const body = renderSkippedComment(E2eSkipCode.NoWebSurface, "ships hooks and a CLI");
    expect(body).toContain("NO_WEB_SURFACE");
    expect(body).toContain("ships hooks and a CLI");
    expect(classifyComment(body)).toBe(WalkthroughCommentStatus.Skipped);
  });

  it("shows a NOT_APPLICABLE reason as the agent's, unverified", () => {
    const body = renderSkippedComment(E2eSkipCode.NotApplicable, "only the email template changed.");
    expect(body).toContain("**No E2E run — not applicable.** only the email template changed.\n");
    expect(body).toContain("Muggle did not verify this reason");
    expect(body).not.toContain("Muggle verified");
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

describe("renderNoAppLogicChangeComment", () => {
  it("settles the slot as skipped, naming the new head, the starting commit, and the reason", () => {
    const body = renderNoAppLogicChangeComment(PRE_CYCLE, HEAD_SHA, null);
    expect(classifyComment(body)).toBe(WalkthroughCommentStatus.Skipped);
    expect(body).toContain("E2E skipped — no app-logic change in `9f8e7d6`");
    expect(body).toContain("since `1a2b3c4`");
    expect(body).toContain("NO_APP_LOGIC_CHANGE");
    expect(body).toContain("README typo");
    expect(body).toContain("No full E2E run is on record");
  });

  it("falls back to the starting commit when the head is unknown or has not moved", () => {
    expect(renderNoAppLogicChangeComment(PRE_CYCLE, null, null)).toContain("no app-logic change since `1a2b3c4`");
    expect(renderNoAppLogicChangeComment(PRE_CYCLE, "1a2b3c4d5e6f7a8b", null)).toContain(
      "no app-logic change since `1a2b3c4`",
    );
  });

  // The last run moves under the notice rather than being dropped, and the
  // sentinel goes with it so the comment reads as this head's skip.
  it("keeps the last full run collapsed underneath while still reading as skipped", () => {
    const body = renderNoAppLogicChangeComment(PRE_CYCLE, HEAD_SHA, lastFullRunOf(builderReport));
    expect(body).toContain("<summary>Last full E2E run on this PR</summary>");
    expect(body).toContain("**✅ PASS** — 3 tests ran");
    expect(body).not.toContain(REPORT_SENTINEL);
    expect(classifyComment(body)).toBe(WalkthroughCommentStatus.Skipped);
  });
});

describe("withRerunNotice", () => {
  const STARTED_AT = new Date("2026-10-27T05:12:40Z");

  it("says a new run is in progress, when it started, and that the results below are the previous run's", () => {
    const body = withRerunNotice(builderReport, STARTED_AT);
    expect(body).toContain("A new E2E run is in progress");
    expect(body).toContain("started 2026-10-27 05:12 UTC");
    expect(body).toContain("The results below are from the previous run");
    expect(body.endsWith(builderReport)).toBe(true);
  });

  // The check keeps judging the run underneath until the new one replaces it.
  it("leaves the comment's classification as it was", () => {
    expect(classifyComment(withRerunNotice(builderReport, STARTED_AT))).toBe(WalkthroughCommentStatus.Reported);
    const skipped = renderSkippedComment(E2eSkipCode.NoWebSurface, "");
    expect(classifyComment(withRerunNotice(skipped, STARTED_AT))).toBe(WalkthroughCommentStatus.Skipped);
  });

  it("replaces an earlier banner rather than stacking a second", () => {
    const twice = withRerunNotice(withRerunNotice(builderReport, STARTED_AT), new Date("2026-10-28T09:00:00Z"));
    expect(twice.match(/A new E2E run is in progress/g)).toHaveLength(1);
    expect(twice).toContain("2026-10-28 09:00 UTC");
  });

  // GitHub can hand a comment back with CRLF line endings.
  it("strips back to the walkthrough it sat on, whatever its line endings", () => {
    const crlfReport = builderReport.replace(/\n/g, "\r\n");
    expect(withoutRerunNotice(withRerunNotice(crlfReport, STARTED_AT))).toBe(crlfReport);
  });
});

describe("lastFullRunOf", () => {
  it("is the walkthrough itself for a reported comment", () => {
    expect(lastFullRunOf(builderReport)).toBe("## E2E Acceptance Results\n\n**✅ PASS** — 3 tests ran");
  });

  it("leaves a rerun banner behind rather than carrying it forward", () => {
    expect(lastFullRunOf(withRerunNotice(builderReport, new Date()))).toBe(
      "## E2E Acceptance Results\n\n**✅ PASS** — 3 tests ran",
    );
  });

  it("hands on the run an earlier skip carried forward, without nesting it", () => {
    const firstSkip = renderNoAppLogicChangeComment(PRE_CYCLE, HEAD_SHA, lastFullRunOf(builderReport));
    const carried = lastFullRunOf(firstSkip);
    expect(carried).toBe("## E2E Acceptance Results\n\n**✅ PASS** — 3 tests ran");
    const secondSkip = renderNoAppLogicChangeComment(PRE_CYCLE, HEAD_SHA, carried);
    expect(secondSkip.match(/Last full E2E run on this PR/g)).toHaveLength(1);
  });

  it("is null for a reserved slot or a skip that carries no run", () => {
    expect(lastFullRunOf(renderReservedComment())).toBeNull();
    expect(lastFullRunOf(renderSkippedComment(E2eSkipCode.NoWebSurface, ""))).toBeNull();
    expect(lastFullRunOf(renderUnreasonedSkipComment())).toBeNull();
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
