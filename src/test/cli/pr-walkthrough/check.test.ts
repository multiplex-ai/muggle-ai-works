import { describe, it, expect } from "vitest";
import { runPrWalkthroughCheck } from "../../../cli/pr-walkthrough/check";
import { CHECK_SUMMARY_MAX_CASES } from "../../../cli/pr-walkthrough/constants";
import { renderNotPassingSummary } from "../../../cli/pr-walkthrough/summary";
import { renderReservedComment, renderSkippedComment } from "../../../pr-walkthrough/comment";
import { renderE2eResultMarker } from "../../../e2e-result/marker";
import { UnpassedCaseStatus, type IE2eResultRecord, type IUnpassedCase } from "../../../e2e-result/types";
import { E2eSkipCode } from "../../../e2e-skip/types";
import { CheckConclusion, WalkthroughCheckOutcome } from "../../../cli/pr-walkthrough/types";

const REPORTED = "<!-- muggle-pr-section:v1 -->\n### Muggle E2E\n3 passed";

const failedCase: IUnpassedCase = {
  name: "Checkout",
  testCaseId: "tc-2",
  status: UnpassedCaseStatus.Failed,
  failedStep: 4,
  detail: "Pay button disabled",
  viewUrl: "https://www.muggle-ai.com/run/2",
};

const inconclusiveCase: IUnpassedCase = {
  name: "Search",
  testCaseId: "tc-3",
  status: UnpassedCaseStatus.Inconclusive,
  detail: "No replayable script",
  viewUrl: "https://www.muggle-ai.com/run/3",
};

/** A walkthrough comment as `build-pr-section` renders it: sentinel, then the result record. */
function walkthrough(record: IE2eResultRecord): string {
  return `<!-- muggle-pr-section:v1 -->\n${renderE2eResultMarker(record)}\n## E2E Acceptance Results`;
}

interface GhCall {
  args: string[];
  input?: string;
}

function ghWithComments(bodies: string[] | null) {
  const calls: GhCall[] = [];
  const run = (args: string[], input?: string): string | null => {
    calls.push({ args: args, input: input });
    if (args.join(" ").includes("/comments") && !args.includes("POST")) {
      return bodies === null
        ? null
        : JSON.stringify(bodies.map((body, index) => ({ id: index + 1, body: body })));
    }
    return "";
  };
  return { calls: calls, run: run };
}

const options = {
  repo: "o/r",
  prNumber: 7,
  headSha: "abc123",
  publishCheckRun: false,
};

const checkRunCall = (calls: GhCall[]): GhCall | undefined =>
  calls.find((call) => call.args.join(" ").includes("check-runs"));

describe("runPrWalkthroughCheck", () => {
  it("passes when the designated comment carries a walkthrough", async () => {
    const gh = ghWithComments([renderReservedComment(), REPORTED]);
    const result = await runPrWalkthroughCheck(options, gh.run);
    expect(result.conclusion).toBe(CheckConclusion.Success);
    expect(result.exitCode).toBe(0);
  });

  it("passes when the comment cites a verified skip code", async () => {
    const gh = ghWithComments([renderSkippedComment(E2eSkipCode.NoWebSurface, "")]);
    const result = await runPrWalkthroughCheck(options, gh.run);
    expect(result.conclusion).toBe(CheckConclusion.Success);
  });

  it("fails while the reserved comment is still empty", async () => {
    const gh = ghWithComments([renderReservedComment()]);
    const result = await runPrWalkthroughCheck(options, gh.run);
    expect(result.conclusion).toBe(CheckConclusion.Failure);
    expect(result.exitCode).toBe(1);
  });

  it("reserves the comment itself when the PR has none, then reports it pending", async () => {
    const gh = ghWithComments(["ship it"]);
    const result = await runPrWalkthroughCheck(options, gh.run);
    expect(result.conclusion).toBe(CheckConclusion.Failure);
    const posted = gh.calls.find((call) => call.args.includes("POST"));
    expect(posted?.input).toContain("muggle-pr-walkthrough");
  });

  it("publishes a check run against the head sha when asked, and exits 0 either way", async () => {
    const gh = ghWithComments([renderReservedComment()]);
    const result = await runPrWalkthroughCheck({ ...options, publishCheckRun: true }, gh.run);
    expect(result.exitCode).toBe(0);
    const published = checkRunCall(gh.calls);
    expect(published?.input).toContain("abc123");
    expect(published?.input).toContain(CheckConclusion.Failure);
  });

  it("does not publish a check run unless asked", async () => {
    const gh = ghWithComments([REPORTED]);
    await runPrWalkthroughCheck(options, gh.run);
    expect(checkRunCall(gh.calls)).toBeUndefined();
  });

  it("stays neutral and exits 0 when the comments cannot be read", async () => {
    const gh = ghWithComments(null);
    const result = await runPrWalkthroughCheck({ ...options, publishCheckRun: true }, gh.run);
    expect(result.conclusion).toBe(CheckConclusion.Neutral);
    expect(result.exitCode).toBe(0);
  });

  it("fails when the walkthrough reports a failed case, and names it in the summary", async () => {
    const gh = ghWithComments([walkthrough({ total: 2, passed: 1, unpassed: [failedCase] })]);
    const result = await runPrWalkthroughCheck(options, gh.run);
    expect(result.outcome).toBe(WalkthroughCheckOutcome.E2eNotPassing);
    expect(result.conclusion).toBe(CheckConclusion.Failure);
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("**Checkout** — failed at step 4: Pay button disabled");
    expect(result.summary).toContain("[open run](https://www.muggle-ai.com/run/2)");
  });

  it("fails on an inconclusive case too — a run that never reached its assertion validated nothing", async () => {
    const gh = ghWithComments([walkthrough({ total: 1, passed: 0, unpassed: [inconclusiveCase] })]);
    const result = await runPrWalkthroughCheck(options, gh.run);
    expect(result.conclusion).toBe(CheckConclusion.Failure);
    expect(result.summary).toContain("**Search** — inconclusive: No replayable script");
  });

  it("publishes the failing cases on the check run, still exiting 0", async () => {
    const gh = ghWithComments([walkthrough({ total: 2, passed: 1, unpassed: [failedCase] })]);
    const result = await runPrWalkthroughCheck({ ...options, publishCheckRun: true }, gh.run);
    expect(result.exitCode).toBe(0);
    const published = JSON.parse(checkRunCall(gh.calls)?.input ?? "{}");
    expect(published.conclusion).toBe(CheckConclusion.Failure);
    expect(published.output.summary).toContain("Checkout");
  });

  it("passes when every case in the record passed", async () => {
    const gh = ghWithComments([walkthrough({ total: 3, passed: 3, unpassed: [] })]);
    const result = await runPrWalkthroughCheck(options, gh.run);
    expect(result.outcome).toBe(WalkthroughCheckOutcome.Settled);
    expect(result.conclusion).toBe(CheckConclusion.Success);
  });

  it("judges the newest walkthrough, so a green re-run posted below a red one clears the check", async () => {
    const gh = ghWithComments([
      walkthrough({ total: 2, passed: 1, unpassed: [failedCase] }),
      walkthrough({ total: 2, passed: 2, unpassed: [] }),
    ]);
    const result = await runPrWalkthroughCheck(options, gh.run);
    expect(result.conclusion).toBe(CheckConclusion.Success);
  });
});

describe("renderNotPassingSummary", () => {
  it("tallies failed and inconclusive cases out of the total", () => {
    const summary = renderNotPassingSummary({ total: 5, passed: 3, unpassed: [failedCase, inconclusiveCase] });
    expect(summary.split("\n")[0]).toContain("1 failed, 1 inconclusive of 5 test cases");
  });

  it("lists at most the cap and points to the comment for the rest", () => {
    const many = Array.from({ length: CHECK_SUMMARY_MAX_CASES + 2 }, (_, i) => ({ ...failedCase, name: `Case ${i}` }));
    const summary = renderNotPassingSummary({ total: many.length, passed: 0, unpassed: many });
    expect(summary.match(/^- ❌/gm)).toHaveLength(CHECK_SUMMARY_MAX_CASES);
    expect(summary).toContain("…and 2 more — see the walkthrough comment.");
  });
});
