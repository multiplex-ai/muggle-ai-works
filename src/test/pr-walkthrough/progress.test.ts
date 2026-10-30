import { describe, it, expect } from "vitest";
import {
  classifyComment,
  isRerunInProgress,
  renderReservedComment,
  renderRunningComment,
  withoutRerunNotice,
  withRerunNotice,
} from "../../pr-walkthrough/comment";
import {
  parseProgressCase,
  readProgressCases,
  withFinishedCase,
  withProgressSection,
} from "../../pr-walkthrough/progress";
import { E2eProgressStatus, WalkthroughCommentStatus, type E2eProgressCase } from "../../pr-walkthrough/types";

const STARTED_AT = new Date("2026-10-30T09:00:00Z");
const WALKTHROUGH = "<!-- muggle-pr-section:v1 -->\n## E2E Acceptance Results\n\n**✅ PASS** — 2 tests ran";

const queued = (testCaseId: string, title: string): E2eProgressCase => ({
  testCaseId: testCaseId,
  title: title,
  status: E2eProgressStatus.Queued,
});

const PLAN = [queued("tc-1", "Login with valid creds"), queued("tc-2", "Checkout flow")];

describe("withProgressSection", () => {
  it("lists every planned case as queued inside a first run's banner", () => {
    const body = withProgressSection(renderRunningComment(STARTED_AT), PLAN) ?? "";
    expect(body).toContain("**E2E tests — 0 of 2 finished**");
    expect(body).toContain("| Login with valid creds | ⏳ Queued |");
    expect(body).toContain("| Checkout flow | ⏳ Queued |");
    expect(readProgressCases(body)).toEqual(PLAN);
  });

  it("keeps the comment classifying as it did, so the walkthrough check stays in progress", () => {
    const running = withProgressSection(renderRunningComment(STARTED_AT), PLAN) ?? "";
    expect(classifyComment(running)).toBe(WalkthroughCommentStatus.Pending);
    const rerun = withProgressSection(withRerunNotice(WALKTHROUGH, STARTED_AT), PLAN) ?? "";
    expect(classifyComment(rerun)).toBe(WalkthroughCommentStatus.Reported);
    expect(isRerunInProgress([rerun])).toBe(true);
  });

  // The previous run's walkthrough must come back whole if the new run never posts.
  it("sits inside the banner, so stripping the banner gives back the walkthrough under it", () => {
    const rerun = withProgressSection(withRerunNotice(WALKTHROUGH, STARTED_AT), PLAN) ?? "";
    expect(withoutRerunNotice(rerun)).toBe(WALKTHROUGH);
  });

  it("rewrites the same body for the same cases, and restores the bare banner for none", () => {
    const banner = renderRunningComment(STARTED_AT);
    const once = withProgressSection(banner, PLAN) ?? "";
    expect(withProgressSection(once, PLAN)).toBe(once);
    expect(withProgressSection(once, [])).toBe(banner);
  });

  it("does nothing on a comment with no run in flight", () => {
    expect(withProgressSection(renderReservedComment(), PLAN)).toBeNull();
    expect(withProgressSection(WALKTHROUGH, PLAN)).toBeNull();
  });

  it("keeps a title that would break the hidden state or the table", () => {
    const awkward = [queued("tc-3", "Signup -- with | pipes -->")];
    const body = withProgressSection(renderRunningComment(STARTED_AT), awkward) ?? "";
    expect(readProgressCases(body)).toEqual(awkward);
    expect(body).toContain("| Signup -- with \\| pipes --> | ⏳ Queued |");
  });
});

describe("withFinishedCase", () => {
  it("updates the planned row in place, keeping the planned title and order", () => {
    const finished: E2eProgressCase = {
      testCaseId: "tc-2",
      title: "tc-2",
      status: E2eProgressStatus.Failed,
      viewUrl: "https://www.muggle-ai.com/run/2",
    };
    expect(withFinishedCase(PLAN, finished)).toEqual([
      PLAN[0],
      { testCaseId: "tc-2", title: "Checkout flow", status: E2eProgressStatus.Failed, viewUrl: "https://www.muggle-ai.com/run/2" },
    ]);
  });

  it("appends a case the plan did not name", () => {
    const prerequisite: E2eProgressCase = { testCaseId: "tc-0", title: "Sign up", status: E2eProgressStatus.Passed };
    expect(withFinishedCase(PLAN, prerequisite)).toEqual([...PLAN, prerequisite]);
  });

  it("links a finished row to its run and counts it", () => {
    const cases = withFinishedCase(PLAN, {
      testCaseId: "tc-1",
      title: "Login with valid creds",
      status: E2eProgressStatus.Passed,
      viewUrl: "https://www.muggle-ai.com/run/1",
    });
    const body = withProgressSection(renderRunningComment(STARTED_AT), cases) ?? "";
    expect(body).toContain("**E2E tests — 1 of 2 finished**");
    expect(body).toContain("| Login with valid creds | [✅ Passed](https://www.muggle-ai.com/run/1) |");
  });
});

describe("parseProgressCase", () => {
  it("reads a case and rejects anything else", () => {
    expect(parseProgressCase(JSON.stringify(PLAN[0]))).toEqual(PLAN[0]);
    expect(parseProgressCase(JSON.stringify({ testCaseId: "tc-1", title: "x", status: "running" }))).toBeUndefined();
    expect(parseProgressCase("not json")).toBeUndefined();
    expect(parseProgressCase(undefined)).toBeUndefined();
  });
});
