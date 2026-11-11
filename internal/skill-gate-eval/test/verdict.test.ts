import { describe, expect, it } from "vitest";

import type { AskQuestionRecord, MockCall, Scenario, ScenarioExpectation } from "../src/types.js";
import { answerAskQuestionCall, questionsAfterFirstCall, verdict } from "../src/verdict.js";

const EXECUTE_TOOL = "muggle-local-execute-test-generation";

const executeCall: MockCall = { tool: EXECUTE_TOOL, args: {}, sequence: 2 };
const projectCall: MockCall = { tool: "muggle-remote-project-list", args: {}, sequence: 0 };
const upFrontQuestion: AskQuestionRecord = { question: "Open the results page after the run?", answer: "Open it", sequence: 1 };
const lateQuestion: AskQuestionRecord = { question: "Did the agent miss anything?", answer: null, sequence: 3 };

function scenarioExpecting(expect: Partial<ScenarioExpectation>): Scenario {
  return {
    name: "timing",
    preferences: {},
    userPrompt: "test the signup flow",
    expect: { askQuestionForGate: false, ...expect },
  };
}

describe("answerAskQuestionCall", () => {
  const scenario: Scenario = {
    ...scenarioExpecting({}),
    askQuestionAnswers: [
      { questionContains: "use case", answer: "Sign up flow" },
      { questionContains: "results", answer: "Open the dashboard" },
    ],
  };

  it("keeps the single-question reply unchanged", () => {
    const answered = answerAskQuestionCall({ questions: [{ question: "Which use case?" }] }, scenario, 4);
    expect(answered.records).toEqual([{ question: "Which use case?", answer: "Sign up flow", sequence: 4 }]);
    expect(answered.replyMessage).toBe('User selected: "Sign up flow"');
  });

  it("records and answers every question in a batch, sharing the call's sequence", () => {
    const batch = { questions: [{ question: "Which use case?" }, { question: "Open the results page?" }, { question: "Anything else?" }] };
    const answered = answerAskQuestionCall(batch, scenario, 7);
    expect(answered.records.map((record) => [record.answer, record.sequence])).toEqual([
      ["Sign up flow", 7],
      ["Open the dashboard", 7],
      [null, 7],
    ]);
    expect(answered.replyMessage).toContain('"Open the results page?" → User selected: "Open the dashboard"');
    expect(answered.replyMessage).toContain('"Anything else?" → [harness] no scripted answer');
  });
});

describe("questionsAfterFirstCall", () => {
  it("returns only the questions sequenced after the tool's first call", () => {
    const late = questionsAfterFirstCall(EXECUTE_TOOL, [projectCall, executeCall], [upFrontQuestion, lateQuestion]);
    expect(late).toEqual([lateQuestion]);
  });

  it("returns null when the tool was never called", () => {
    expect(questionsAfterFirstCall(EXECUTE_TOOL, [projectCall], [upFrontQuestion])).toBeNull();
  });
});

describe("verdict question timing", () => {
  it("passes noQuestionAfterTool when every question came before the call", () => {
    const result = verdict(scenarioExpecting({ noQuestionAfterTool: EXECUTE_TOOL }), [projectCall, executeCall], [upFrontQuestion], false);
    expect(result.pass).toBe(true);
  });

  it("fails noQuestionAfterTool and names the late question", () => {
    const result = verdict(scenarioExpecting({ noQuestionAfterTool: EXECUTE_TOOL }), [executeCall], [upFrontQuestion, lateQuestion], false);
    expect(result.pass).toBe(false);
    expect(result.reasons.join("\n")).toContain("Did the agent miss anything?");
  });

  it("fails noQuestionAfterTool when the tool never ran, rather than passing vacuously", () => {
    const result = verdict(scenarioExpecting({ noQuestionAfterTool: EXECUTE_TOOL }), [projectCall], [], false);
    expect(result.pass).toBe(false);
    expect(result.reasons.join("\n")).toContain(`expected ${EXECUTE_TOOL} to be called`);
  });

  it("passes questionAfterTool when a question follows the call", () => {
    const result = verdict(scenarioExpecting({ questionAfterTool: EXECUTE_TOOL }), [executeCall], [upFrontQuestion, lateQuestion], false);
    expect(result.pass).toBe(true);
  });

  it("passes questionBeforeTool when the matching question was batched before the call", () => {
    const expectation = { questionBeforeTool: { tool: EXECUTE_TOOL, questionContains: "results page" } };
    const result = verdict(scenarioExpecting(expectation), [executeCall], [upFrontQuestion], false);
    expect(result.pass).toBe(true);
  });

  it("fails questionBeforeTool when the matching question came only after the call, or never", () => {
    const expectation = { questionBeforeTool: { tool: EXECUTE_TOOL, questionContains: "miss anything" } };
    const askedLate = verdict(scenarioExpecting(expectation), [executeCall], [upFrontQuestion, lateQuestion], false);
    const neverAsked = verdict(scenarioExpecting(expectation), [executeCall], [upFrontQuestion], false);
    expect(askedLate.pass).toBe(false);
    expect(neverAsked.pass).toBe(false);
    expect(askedLate.reasons.join("\n")).toContain(`before ${EXECUTE_TOOL}`);
  });

  it("fails questionAfterTool when the run asked nothing after the call", () => {
    const result = verdict(scenarioExpecting({ questionAfterTool: EXECUTE_TOOL }), [executeCall], [upFrontQuestion], false);
    expect(result.pass).toBe(false);
    expect(result.reasons.join("\n")).toContain(`expected a question after ${EXECUTE_TOOL}`);
  });
});
