import { describe, expect, it } from "vitest";

import { mockToolSpecs } from "../../skill-gate-eval/src/mock-tools.js";
import type { Fixtures } from "../../skill-gate-eval/src/types.js";
import { CREATED_TEST_CASE_ID_PREFIX, CREATED_USE_CASE_ID_PREFIX, EMPTY_MOCK_LIST } from "../src/constants.js";
import { mergedMockToolSpecs, sequencedMockToolSpecs } from "../src/tools/sequenced-mock-mcp.js";
import { supplementalMockToolSpecs } from "../src/tools/supplemental-mock-tools.js";

const greetingCases = {
  items: [
    { id: "tc-greeting-named", useCaseId: "uc-greeting", title: "Greeting names the visitor" },
    { id: "tc-greeting-blank", useCaseId: "uc-greeting", title: "Greeting falls back to friend" },
  ],
};
const newsletterCases = { items: [{ id: "tc-newsletter-subscribe", useCaseId: "uc-newsletter", title: "Subscribe" }] };
const project: Fixtures = { testCasesByUseCase: { "uc-greeting": greetingCases, "uc-newsletter": newsletterCases } };

function answererFor(fixtures: Fixtures): (toolName: string, input?: Record<string, unknown>) => unknown {
  const specs = sequencedMockToolSpecs(fixtures);
  return (toolName, input = {}) => specs.find((spec) => spec.name === toolName)!.reply(input);
}

describe("mergedMockToolSpecs", () => {
  it("serves each tool name once, the shared list and every supplemental tool included", () => {
    const names = mergedMockToolSpecs({}).map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
    for (const spec of [...mockToolSpecs({}), ...supplementalMockToolSpecs({})]) expect(names).toContain(spec.name);
  });

  it("declares no supplemental tool twice, so none silently shadows another", () => {
    const names = supplementalMockToolSpecs({}).map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("falls through to the shared reply when the scenario scripts no per-use-case lists", () => {
    const answer = answererFor({ testCases: { items: [{ id: "tc-1" }] } });
    expect(answer("muggle-remote-test-case-list-by-use-case", { useCaseId: "uc-any" })).toEqual({ items: [{ id: "tc-1" }] });
    expect(answer("muggle-remote-test-case-get", { testCaseId: "tc-unknown" })).toEqual(
      mockToolSpecs({}).find((spec) => spec.name === "muggle-remote-test-case-get")!.reply(),
    );
  });
});

describe("per-use-case test cases", () => {
  it("answers each use case with its own list, and an unlisted one with none", () => {
    const answer = answererFor(project);
    expect(answer("muggle-remote-test-case-list-by-use-case", { useCaseId: "uc-greeting" })).toEqual(greetingCases);
    expect(answer("muggle-remote-test-case-list-by-use-case", { useCaseId: "uc-newsletter" })).toEqual(newsletterCases);
    expect(answer("muggle-remote-test-case-list-by-use-case", { useCaseId: "uc-other" })).toEqual(EMPTY_MOCK_LIST);
  });

  it("gets a listed test case by id from whichever use case holds it", () => {
    const answer = answererFor(project);
    expect(answer("muggle-remote-test-case-get", { testCaseId: "tc-newsletter-subscribe" })).toEqual(newsletterCases.items[0]);
  });

  it("lists the project's test cases as every use case's, unless the scenario scripts the project list", () => {
    expect(answererFor(project)("muggle-remote-test-case-list")).toEqual({
      items: [...greetingCases.items, ...newsletterCases.items],
    });
    expect(answererFor({ ...project, testCases: EMPTY_MOCK_LIST })("muggle-remote-test-case-list")).toEqual(EMPTY_MOCK_LIST);
  });
});

describe("case lifecycle mocks", () => {
  it("numbers created test cases in order and reads them back by id", () => {
    const answer = answererFor(project);
    const first = answer("muggle-remote-test-case-create", { useCaseId: "uc-greeting", title: "Farewell names the visitor" });
    const second = answer("muggle-remote-test-case-create", { useCaseId: "uc-greeting", title: "Farewell falls back" });
    expect(first).toMatchObject({ id: `${CREATED_TEST_CASE_ID_PREFIX}1`, title: "Farewell names the visitor" });
    expect(second).toMatchObject({ id: `${CREATED_TEST_CASE_ID_PREFIX}2` });
    expect(answer("muggle-remote-test-case-get", { testCaseId: `${CREATED_TEST_CASE_ID_PREFIX}2` })).toEqual(second);
  });

  it("starts each run's numbering afresh", () => {
    answererFor(project)("muggle-remote-test-case-create", { title: "a" });
    expect(answererFor(project)("muggle-remote-test-case-create", { title: "b" })).toMatchObject({
      id: `${CREATED_TEST_CASE_ID_PREFIX}1`,
    });
  });

  it("creates one use case per instruction and previews a test case from the instruction it was given", () => {
    const answer = answererFor({});
    expect(answer("muggle-remote-use-case-create-from-prompts", { instructions: ["Home page", "Footer"] })).toMatchObject({
      items: [{ id: `${CREATED_USE_CASE_ID_PREFIX}1`, title: "Home page" }, { id: `${CREATED_USE_CASE_ID_PREFIX}2`, title: "Footer" }],
    });
    expect(
      answer("muggle-remote-test-case-generate-from-prompt", { useCaseId: "uc-greeting", instruction: "Farewell line renders" }),
    ).toMatchObject({ testCases: [{ useCaseId: "uc-greeting", title: "Farewell line renders" }] });
  });

  it("acknowledges a delete with the id it was handed", () => {
    const answer = answererFor({});
    expect(answer("muggle-remote-test-case-delete", { testCaseId: "tc-1" })).toEqual({ id: "tc-1", deleted: true });
    expect(answer("muggle-remote-use-case-delete", { useCaseId: "uc-1" })).toEqual({ id: "uc-1", deleted: true });
  });

  it("keeps the shared input fields gates read when a supplemental tool refines a shared one", () => {
    const executeShape = mergedMockToolSpecs({}).find((spec) => spec.name === "muggle-local-execute-test-generation")!.shape;
    expect(Object.keys(executeShape)).toEqual(expect.arrayContaining(["testCase", "showUi", "freshSession"]));
  });

  it("offers the event-emit call the real tool's fields, so an event can name its type", () => {
    const emitShape = mergedMockToolSpecs({}).find((spec) => spec.name === "muggle-local-telemetry-event-emit")!.shape;
    expect(Object.keys(emitShape)).toEqual(expect.arrayContaining(["eventType", "skillName", "metadata"]));
    expect(answererFor({})("muggle-local-telemetry-event-emit", { eventType: "muggle-pr-followup:tick" })).toEqual({ ok: true });
  });

  it("names the requested case in a default prerequisite chain", () => {
    expect(answererFor({})("muggle-remote-test-case-ancestors-get", { testCaseId: "tc-9" })).toMatchObject({
      testCaseId: "tc-9",
      ancestors: [],
    });
  });
});

describe("per-case runs", () => {
  const fixtureRun = {
    runId: "run-home-1",
    status: "passed",
    testCaseId: "tc-home",
    viewUrl: "https://example.invalid/runs/run-home-1",
  };
  const runs: Fixtures = {
    executeResult: fixtureRun,
    runResult: { runId: "run-home-1", status: "passed", steps: [{ testCaseId: "tc-home", screenshot: "run-home-1/0.png" }] },
  };

  it("answers the fixture run's own case with the fixture run itself", () => {
    expect(answererFor(runs)("muggle-local-execute-test-generation", { testCase: { id: "tc-home" } })).toEqual(fixtureRun);
  });

  it("answers another case with that case's own run, under a run id its reads answer for", () => {
    const answer = answererFor(runs);
    const executed = answer("muggle-local-execute-replay", { testCase: JSON.stringify({ id: "tc-new-1" }) });
    expect(executed).toEqual({
      runId: "run-home-1-tc-new-1",
      status: "passed",
      testCaseId: "tc-new-1",
      viewUrl: "https://example.invalid/runs/run-home-1-tc-new-1",
    });
    expect(answer("muggle-local-run-result-get", { runId: "run-home-1-tc-new-1" })).toEqual({
      runId: "run-home-1-tc-new-1",
      status: "passed",
      steps: [{ testCaseId: "tc-new-1", screenshot: "run-home-1-tc-new-1/0.png" }],
    });
  });

  it("answers a run id no execute call produced with the fixture, as before", () => {
    expect(answererFor(runs)("muggle-local-run-result-get", { runId: "run-unknown" })).toEqual(runs.runResult);
  });

  it("leaves a sequenced execute slot to the shared reply, so its calls still answer in order", () => {
    const answer = answererFor({ executeResult: { sequence: [{ runId: "r1" }, { runId: "r2" }] } });
    expect(answer("muggle-local-execute-test-generation", { testCase: { id: "tc-a" } })).toEqual({ runId: "r1" });
    expect(answer("muggle-local-execute-replay", { testCase: { id: "tc-b" } })).toEqual({ runId: "r2" });
  });
});
