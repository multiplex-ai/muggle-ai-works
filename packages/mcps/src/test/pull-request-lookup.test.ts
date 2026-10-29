/** Tests for finding the open pull request a checkout's branch heads. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ghOutputByCwd = new Map<string, { error: Error | null; stdout: string }>();
const ghCalls: string[] = [];

vi.mock("node:child_process", () => ({
  execFile: (
    _file: string,
    _args: string[],
    options: { cwd: string },
    callback: (error: Error | null, stdout: string) => void,
  ) => {
    ghCalls.push(options.cwd);
    const output = ghOutputByCwd.get(options.cwd) ?? { error: new Error("no pull requests found"), stdout: "" };
    callback(output.error, output.stdout);
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("MUGGLE_PR_LOOKUP", "on");
  ghOutputByCwd.clear();
  ghCalls.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function lookUp(cwd: string) {
  const { lookUpCheckoutPullRequest } = await import("../shared/queue-priority/pull-request-lookup.js");
  return await lookUpCheckoutPullRequest(cwd);
}

function prView(state: string): { error: null; stdout: string } {
  return {
    error: null,
    stdout: JSON.stringify({ number: 709, url: "https://github.com/o/r/pull/709", createdAt: "2026-10-27T10:00:00Z", state: state }),
  };
}

describe("lookUpCheckoutPullRequest", () => {
  it("reads the open pull request's number, url and opening time", async () => {
    ghOutputByCwd.set("/wt/a", prView("OPEN"));

    expect(await lookUp("/wt/a")).toEqual({
      number: 709,
      url: "https://github.com/o/r/pull/709",
      createdAt: Date.parse("2026-10-27T10:00:00Z"),
    });
  });

  it("ranks a branch whose pull request merged or closed as having none", async () => {
    ghOutputByCwd.set("/wt/merged", prView("MERGED"));
    ghOutputByCwd.set("/wt/closed", prView("CLOSED"));

    expect(await lookUp("/wt/merged")).toBeNull();
    expect(await lookUp("/wt/closed")).toBeNull();
  });

  it("answers none when gh fails or prints something unreadable", async () => {
    ghOutputByCwd.set("/wt/garbled", { error: null, stdout: "not json" });

    expect(await lookUp("/wt/no-pr")).toBeNull();
    expect(await lookUp("/wt/garbled")).toBeNull();
  });

  it("asks gh once per checkout while its answer is fresh", async () => {
    ghOutputByCwd.set("/wt/a", prView("OPEN"));
    const { lookUpCheckoutPullRequest } = await import("../shared/queue-priority/pull-request-lookup.js");

    await lookUpCheckoutPullRequest("/wt/a");
    await lookUpCheckoutPullRequest("/wt/a");

    expect(ghCalls).toEqual(["/wt/a"]);
  });

  it("never calls gh while lookups are turned off", async () => {
    vi.stubEnv("MUGGLE_PR_LOOKUP", "off");
    ghOutputByCwd.set("/wt/a", prView("OPEN"));

    expect(await lookUp("/wt/a")).toBeNull();
    expect(ghCalls).toEqual([]);
  });
});
