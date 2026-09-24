import { describe, it, expect } from "vitest";
import { runPrWalkthroughCheck } from "../../../cli/pr-walkthrough/check";
import { renderReservedComment, renderSkippedComment } from "../../../pr-walkthrough/comment";
import { E2eSkipCode } from "../../../e2e-skip/types";
import { CheckConclusion } from "../../../cli/pr-walkthrough/types";

const REPORTED = "<!-- muggle-pr-section:v1 -->\n### Muggle E2E\n3 passed";

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
});
