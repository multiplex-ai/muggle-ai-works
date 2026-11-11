import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { UNSCRIPTED_BASH_RESPONSE } from "../src/constants.js";
import { loadAgentScenarioFile } from "../src/scenario.js";
import { createBashResponder, resolveScriptedBashResponse } from "../src/tools/scripted-replies.js";

const scenariosDir = path.join(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  "scenarios",
);

describe("resolveScriptedBashResponse", () => {
  const responses = [
    { commandContains: "build-pr-section", response: "rendered" },
    { commandContains: "", response: UNSCRIPTED_BASH_RESPONSE },
  ];

  it("returns the first match, not the best one", () => {
    expect(resolveScriptedBashResponse("echo x | muggle build-pr-section", responses)).toBe(
      "rendered",
    );
  });

  it("falls back for a command nothing stubs", () => {
    expect(resolveScriptedBashResponse("gh api repos/o/r/pulls", undefined)).toBe(
      UNSCRIPTED_BASH_RESPONSE,
    );
  });

  it("can stub a genuinely empty result, which the fallback cannot express", () => {
    const withEmpty = [{ commandContains: "issues/1/comments", response: "" }, ...responses];

    expect(resolveScriptedBashResponse("gh api repos/o/r/issues/1/comments", withEmpty)).toBe("");
    expect(resolveScriptedBashResponse("gh api repos/o/r/issues/1/comments", responses)).toBe(
      UNSCRIPTED_BASH_RESPONSE,
    );
  });
});

describe("visual-walkthrough-builder Mode A scenario", () => {
  const scenario = loadAgentScenarioFile(
    path.join(scenariosDir, "visual-walkthrough-builder.json"),
  ).scenarios.find((candidate) => candidate.name === "mode-a-posts-comment-to-pr");

  // The agent looks for an existing walkthrough before posting, so a rerun updates one
  // comment instead of appending per attempt. This is the command it issues.
  const existingCommentsLookup =
    'gh api "repos/multiplex-ai/demo-app/issues/123/comments" ' +
    `--jq '[.[] | select(.body | contains("muggle-pr-section")) | .id] | join(" ")'`;

  it("is present", () => {
    expect(scenario).toBeDefined();
  });

  it("stubs the existing-walkthrough lookup as finding nothing", () => {
    const response = resolveScriptedBashResponse(
      existingCommentsLookup,
      scenario?.bashResponses,
    );

    // Falling through to the placeholder reads as a non-empty id list, which sends the
    // agent to update a comment that does not exist instead of posting a fresh one.
    expect(response).not.toBe(UNSCRIPTED_BASH_RESPONSE);
    expect(response).toBe("");
  });

  it("still stubs the fresh-post path the scenario asserts on", () => {
    expect(
      resolveScriptedBashResponse("gh pr comment 123 --body-file -", scenario?.bashResponses),
    ).toContain("pull/123");
  });
});

describe("muggle-pr-followup tick verdict stubs", () => {
  const scenario = loadAgentScenarioFile(
    path.join(scenariosDir, "muggle-pr-followup.tick.json"),
  ).scenarios.find((candidate) => candidate.name === "conflicting-branch-dispatches-rebase");

  it("answers a lookup of the verdict script with its path, not a verdict", () => {
    // A verdict answer to `find` lets the agent dispatch without ever running the verdict call the scenario asserts on.
    expect(
      resolveScriptedBashResponse('find /plugin -name "pr-watch-verdict.mjs"', scenario?.bashResponses),
    ).toBe("{{pluginRoot}}/scripts/pr-watch-verdict.mjs");
  });

  it("answers the verdict call itself with the verdict", () => {
    const verdictCall =
      'node "/plugin/scripts/pr-watch-verdict.mjs" tick --pr-key "multiplex-ai/muggle-ai-works#540" --head 9f2c1e4 --rebase-due yes --ci green';
    expect(resolveScriptedBashResponse(verdictCall, scenario?.bashResponses)).toBe("VERDICT=dispatch-rebase");
  });
});

describe("muggle-do scenarios answer the agent's own edits", () => {
  const scenarioNamed = (file: string, name: string) =>
    loadAgentScenarioFile(path.join(scenariosDir, file)).scenarios.find((candidate) => candidate.name === name);

  it("full-forward diffs and tests whatever the agent wrote, not a canned implementation", () => {
    const responses = scenarioNamed("muggle-do.adherence.json", "full-forward")?.bashResponses;
    const answer = createBashResponder(responses, (command) => `ran ${command}`);
    expect(answer("git diff --name-only main...HEAD")).toBe("ran git add -A -N && git diff --name-only HEAD");
    expect(answer("git diff main...HEAD")).toBe("ran git add -A -N && git diff HEAD");
    expect(answer("guard-run -- npm test")).toContain("node --test");
    expect(answer("curl -s http://localhost:3000/")).toContain("node src/server.js");
  });

  it("reviews-mixed shows a posted reply when the agent re-reads the thread, and not before", () => {
    const responses = scenarioNamed("muggle-do.modes.json", "reviews-mixed")?.bashResponses;
    const answer = createBashResponder(responses, (command) => command);
    const listComments = "gh api repos/acme/tiny-web-app/pulls/142/comments";
    const commentIds = () => (JSON.parse(answer(listComments)) as { id: number }[]).map((comment) => comment.id);

    expect(commentIds()).toEqual([3305, 3306]);
    expect(answer("gh api -X POST repos/acme/tiny-web-app/pulls/142/comments/3305/replies -f body=x")).toContain('"id": 3401');
    expect(commentIds()).toEqual([3305, 3306, 3401]);
    expect(answer("gh api -X POST repos/acme/tiny-web-app/pulls/142/comments/3306/replies -f body=y")).toContain('"id": 3402');
    expect(commentIds()).toEqual([3305, 3306, 3401, 3402]);
  });
});
