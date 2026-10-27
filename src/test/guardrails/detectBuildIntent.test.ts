import { describe, it, expect } from "vitest";
import { detectBuildIntent, isMuggleDoForwardInvocation } from "../../guardrails/detectBuildIntent";

describe("detectBuildIntent", () => {
  it("matches build/implement/fix asks", () => {
    expect(detectBuildIntent("implement a dark-mode toggle")).toBe(true);
    expect(detectBuildIntent("can you build the export feature")).toBe(true);
    expect(detectBuildIntent("fix the null crash in the parser")).toBe(true);
    expect(detectBuildIntent("add a retry to the upload")).toBe(true);
  });
  it("matches PR dev-cycle asks muggle-do owns", () => {
    expect(detectBuildIntent("resolve the merge conflicts on my branch and get the PR green")).toBe(true);
    expect(detectBuildIntent("can you resolve the conflicts")).toBe(true);
    expect(detectBuildIntent("get the PR passing")).toBe(true);
  });
  it("ignores questions and non-build asks", () => {
    expect(detectBuildIntent("why does the failed job have no screenshots?")).toBe(false);
    expect(detectBuildIntent("what is next")).toBe(false);
    expect(detectBuildIntent("explain how auth works")).toBe(false);
    expect(detectBuildIntent("resolve the discussion thread with the customer")).toBe(false);
  });
  it("ignores slash commands, which isMuggleDoForwardInvocation judges instead", () => {
    expect(detectBuildIntent("/muggle-do address reviews 1 on https://github.com/o/r/pull/2")).toBe(false);
    expect(detectBuildIntent("/mdo implement a dark-mode toggle")).toBe(false);
  });
});

describe("isMuggleDoForwardInvocation", () => {
  it.each([
    "/mdo paginate the export page",
    "/muggle-do implement a dark-mode toggle",
    "/muggle:muggle-do take this Jira ticket and run with it",
    "/muggle:mdo the export page should paginate",
    "$muggle:muggle-do the export page should paginate",
    "/MDO paginate the export page",
    "/mdo fix ci flakiness in the upload test",
    "/mdo rebase the parser onto the new tokenizer",
  ])("treats %s as a forward task", (prompt) => {
    expect(isMuggleDoForwardInvocation(prompt)).toBe(true);
  });

  it.each(["/mdo", "/muggle-do help", "/mdo menu", "/muggle:muggle-do ?"])("leaves the menu form %s unarmed", (prompt) => {
    expect(isMuggleDoForwardInvocation(prompt)).toBe(false);
  });

  it.each([
    "/muggle-do address reviews 101 102 on https://github.com/o/r/pull/2 slug=fix-parser",
    "/muggle-do address-reviews 101 on https://github.com/o/r/pull/2",
    "/muggle-do fix ci lint test on https://github.com/o/r/pull/2 slug=fix-parser",
    "/muggle-do rebase on https://github.com/o/r/pull/2 slug=fix-parser",
    "/mdo resolve conflicts on https://gitlab.example.com/g/r/-/merge_requests/9",
    "/muggle-do post-merge cleanup slug=fix-parser state=merged",
  ])("leaves the programmatic directive %s unarmed", (prompt) => {
    expect(isMuggleDoForwardInvocation(prompt)).toBe(false);
  });

  it.each(["/muggle-test the checkout flow", "/other:muggle-do implement it", "/clear", "$5 to fix it", "implement dark mode"])(
    "ignores %s, which does not invoke muggle-do",
    (prompt) => {
      expect(isMuggleDoForwardInvocation(prompt)).toBe(false);
    },
  );
});
