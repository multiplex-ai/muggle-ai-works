import { describe, it, expect } from "vitest";
import { locatePrRepo } from "../../watchdog/prLocator.js";

describe("locatePrRepo", () => {
  it("prefers the PR URL", () => {
    expect(
      locatePrRepo({
        url: "https://github.com/multiplex-ai/muggle-ai-works/pull/341",
        repo: "wrong/pair",
      }),
    ).toEqual({ owner: "multiplex-ai", name: "muggle-ai-works" });
  });

  it("falls back to an owner/name repo field when the URL is unusable", () => {
    expect(locatePrRepo({ repo: "multiplex-ai/muggle-ai-brain" })).toEqual({
      owner: "multiplex-ai",
      name: "muggle-ai-brain",
    });
  });

  it("returns null for a legacy owner-less repo field with no URL", () => {
    expect(locatePrRepo({ repo: "muggle-ai-brain" })).toBeNull();
    expect(locatePrRepo({})).toBeNull();
  });
});
