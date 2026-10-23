import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockEvaluate } = vi.hoisted(() => ({ mockEvaluate: vi.fn() }));

vi.mock("@muggleai/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@muggleai/mcp")>()),
  evaluateCheckoutFreshness: mockEvaluate,
}));

import { CheckoutFreshnessVerdict, type ICheckoutFreshnessReport } from "@muggleai/mcp";
import { checkoutFreshnessCommand, renderCheckoutFreshnessSummary } from "../../cli/checkout-freshness";

const report = (overrides: Partial<ICheckoutFreshnessReport>): ICheckoutFreshnessReport => ({
  verdict: CheckoutFreshnessVerdict.Fresh,
  reason: "HEAD contains origin/master (abc1234)",
  checkoutRoot: "/repo/.claude/worktrees/x",
  mainWorktreeRoot: "/repo",
  branch: "users/me/x",
  headSha: "1111111",
  baseRef: "refs/remotes/origin/master",
  baseSha: "abc1234",
  behindBy: 0,
  creationSha: null,
  inheritedCommitCount: 0,
  inheritedCommits: [],
  hasFetchFailed: false,
  ...overrides,
});

describe("renderCheckoutFreshnessSummary", () => {
  it("leads with the verdict and reason, then the facts behind them", () => {
    const summary = renderCheckoutFreshnessSummary(report({}));
    expect(summary.split("\n")).toEqual([
      "FRESH: HEAD contains origin/master (abc1234)",
      "checkout: /repo/.claude/worktrees/x",
      "head: 1111111 (users/me/x)",
      "base: refs/remotes/origin/master @ abc1234",
    ]);
  });

  it("warns when the fetch failed and lists inherited commits", () => {
    const summary = renderCheckoutFreshnessSummary(
      report({ branch: null, hasFetchFailed: true, inheritedCommits: ["2222222 peer work"] }),
    );
    expect(summary).toContain("head: 1111111 (detached)");
    expect(summary).toContain("warning: fetching the base failed");
    expect(summary).toContain("inherited: 2222222 peer work");
  });
});

describe("checkoutFreshnessCommand", () => {
  let written = "";

  beforeEach(() => {
    written = "";
    process.exitCode = undefined;
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("fetches by default and passes the cwd and base through", async () => {
    mockEvaluate.mockResolvedValue(report({}));
    await checkoutFreshnessCommand({ cwd: "/repo/x", base: "develop", fetch: true });
    expect(mockEvaluate).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/repo/x", baseBranch: "develop", shouldFetchBase: true }),
    );
  });

  it("skips the fetch on --no-fetch", async () => {
    mockEvaluate.mockResolvedValue(report({}));
    await checkoutFreshnessCommand({ fetch: false });
    expect(mockEvaluate).toHaveBeenCalledWith(expect.objectContaining({ shouldFetchBase: false }));
  });

  it.each([
    [CheckoutFreshnessVerdict.Fresh, undefined],
    [CheckoutFreshnessVerdict.NotApplicable, undefined],
    [CheckoutFreshnessVerdict.BehindBase, 1],
    [CheckoutFreshnessVerdict.ForeignBase, 1],
  ])("exits %s with code %s", async (verdict, exitCode) => {
    mockEvaluate.mockResolvedValue(report({ verdict: verdict }));
    await checkoutFreshnessCommand({ fetch: true });
    expect(process.exitCode).toBe(exitCode);
  });

  it("prints the full report on --json", async () => {
    const behind = report({ verdict: CheckoutFreshnessVerdict.BehindBase, behindBy: 3 });
    mockEvaluate.mockResolvedValue(behind);
    await checkoutFreshnessCommand({ fetch: true, json: true });
    expect(JSON.parse(written)).toEqual(behind);
  });
});
