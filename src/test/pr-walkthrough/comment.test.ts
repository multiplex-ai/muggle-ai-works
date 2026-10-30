import { describe, it, expect } from "vitest";
import {
  classifyComment,
  isRerunInProgress,
  lastFullRunOf,
  renderDependencyBotComment,
  renderNoAppLogicChangeComment,
  renderReservedComment,
  renderRunningComment,
  renderSkippedComment,
  walkthroughVerdict,
  withoutRerunNotice,
  withRerunNotice,
} from "../../pr-walkthrough/comment";
import { E2eSkipCode } from "../../e2e-skip/types";
import {
  REPORT_SENTINEL,
  RETIRED_UNREASONED_SKIP_HEADLINE,
  WALKTHROUGH_COMMENT_HEADING,
  WALKTHROUGH_SKIPPED_MARKER,
  WALKTHROUGH_SLOT_MARKER,
} from "../../pr-walkthrough/constants";
import { WalkthroughCommentStatus, WalkthroughVerdict } from "../../pr-walkthrough/types";

const reported = `${WALKTHROUGH_SLOT_MARKER}\n<!-- muggle-pr-section:v1 -->\n### Muggle E2E\n3 passed`;
const builderReport = "<!-- muggle-pr-section:v1 -->\n## E2E Acceptance Results\n\n**✅ PASS** — 3 tests ran";
const PRE_CYCLE = { preCycleSha: "1a2b3c4d5e6f", baseTipSha: null, reason: "README typo" };
const REBASED_CYCLE = { preCycleSha: "aeabe83db003", baseTipSha: "be4b765cf2ba", reason: "clean replay onto master" };
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

  it("says the E2E feasibility check is pending", () => {
    expect(renderReservedComment()).toContain("**Waiting for the E2E feasibility check.**");
  });
});

describe("renderRunningComment", () => {
  const STARTED_AT = new Date("2026-10-30T18:05:12Z");

  it("says the run is in progress and when it started", () => {
    const body = renderRunningComment(STARTED_AT);
    expect(body).toContain("**E2E running — waiting for the report.**");
    expect(body).toContain("2026-10-30 18:05 UTC");
    expect(body).not.toContain("feasibility check");
  });

  it("stays pending and keeps the walkthrough check in progress", () => {
    const body = renderRunningComment(STARTED_AT);
    expect(classifyComment(body)).toBe(WalkthroughCommentStatus.Pending);
    expect(walkthroughVerdict([body])).toBe(WalkthroughVerdict.Pending);
    expect(isRerunInProgress([body])).toBe(true);
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
    expect(body).toContain("**E2E not feasible.** only the email template changed.\n");
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
  it("states plainly that E2E is not feasible", () => {
    expect(renderSkippedComment(E2eSkipCode.EmptyDiff, "")).toContain("**E2E not feasible.**");
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

  it("names the base a rebased cycle replayed onto and the head it started from", () => {
    const body = renderNoAppLogicChangeComment(REBASED_CYCLE, HEAD_SHA, lastFullRunOf(builderReport));
    expect(classifyComment(body)).toBe(WalkthroughCommentStatus.Skipped);
    expect(body).toContain("E2E skipped — the rebase onto `be4b765` changed no app logic in this PR");
    expect(body).toContain("in the rebase of `aeabe83`");
    expect(body).toContain("clean replay onto master");
    expect(body).toContain("**✅ PASS** — 3 tests ran");
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

describe("isRerunInProgress", () => {
  it("is true while the designated comment carries a rerun banner", () => {
    expect(isRerunInProgress(["looks good", withRerunNotice(builderReport, new Date())])).toBe(true);
  });

  it("is false once the new run's walkthrough has replaced the banner", () => {
    expect(isRerunInProgress([builderReport])).toBe(false);
  });

  it("ignores the banner's marker in a comment that is not the designated one", () => {
    expect(isRerunInProgress(["quoting: <!-- muggle-pr-walkthrough-rerun -->"])).toBe(false);
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
  });
});

describe("classifyComment", () => {
  it("reads a rendered walkthrough as reported", () => {
    expect(classifyComment(reported)).toBe(WalkthroughCommentStatus.Reported);
  });

  it("ignores a comment that is not the designated slot", () => {
    expect(classifyComment("looks good to me")).toBe(WalkthroughCommentStatus.NotDesignated);
  });

  it("reads the retired no-reason settle as pending, so it never passes for a skip", () => {
    const retired =
      `${WALKTHROUGH_SLOT_MARKER}\n${WALKTHROUGH_SKIPPED_MARKER}\n${WALKTHROUGH_COMMENT_HEADING}\n\n` +
      `${RETIRED_UNREASONED_SKIP_HEADLINE} The session ended still owing an acceptance run.`;
    expect(classifyComment(retired)).toBe(WalkthroughCommentStatus.Pending);
    expect(walkthroughVerdict([retired])).toBe(WalkthroughVerdict.Pending);
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
