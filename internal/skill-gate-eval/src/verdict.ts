/**
 * Judges one run's trace against its scenario. Shared by both hosts' harnesses
 * (harness.ts for the agent SDK, codex-harness.ts for Codex), so a verdict means
 * the same thing whichever host produced the trace.
 */

import type { AskQuestionRecord, MockCall, RunVerdict, Scenario } from "./types.js";

export function matchAskQuestionAnswer(
  question: string,
  scenario: Scenario,
): string | null {
  for (const a of scenario.askQuestionAnswers ?? []) {
    if (question.includes(a.questionContains)) return a.answer;
  }
  return null;
}

/**
 * Answer one AskQuestion call: a record per question it carries, all sharing
 * the call's `sequence`, and the message that hands the agent its answers.
 *
 * Output shape: `{ records: [{ question: "Which use case…?", answer: "Sign up flow", sequence: 4 }],
 * replyMessage: 'User selected: "Sign up flow"' }`
 */
export function answerAskQuestionCall(
  input: Record<string, unknown>,
  scenario: Scenario,
  sequence: number,
): { records: AskQuestionRecord[]; replyMessage: string } {
  const records = extractQuestionTexts(input).map((question) => ({
    question: question,
    answer: matchAskQuestionAnswer(question, scenario),
    sequence: sequence,
  }));
  const replyFor = (record: AskQuestionRecord): string => record.answer !== null
    ? `User selected: "${record.answer}"`
    : "[harness] no scripted answer for this question — scenario should add one";
  const replyMessage = records.length === 1
    ? replyFor(records[0])
    : records.map((record) => `${JSON.stringify(record.question)} → ${replyFor(record)}`).join("\n");
  return { records: records, replyMessage: replyMessage };
}

/**
 * Decide whether an AskQuestion call relates to the gate under test.
 * The simplest signal is `gateQuestionSubstring` — when present, an
 * AskQuestion whose text contains the substring is "the gate firing".
 */
export function isGateQuestion(question: string, scenario: Scenario): boolean {
  const sub = scenario.expect.gateQuestionSubstring;
  if (!sub) return false;
  return question.includes(sub);
}

/** Every question text in one AskQuestion call, in order — a batch carries several. */
export function extractQuestionTexts(input: Record<string, unknown>): string[] {
  const questions = (input as { questions?: unknown }).questions;
  if (Array.isArray(questions) && questions.length > 0) {
    return questions.map((q) => {
      const text = (q as { question?: unknown }).question;
      return typeof text === "string" ? text : "";
    });
  }
  return [extractFirstQuestionText(input)];
}

export function extractFirstQuestionText(input: Record<string, unknown>): string {
  const questions = (input as { questions?: unknown }).questions;
  if (Array.isArray(questions) && questions.length > 0) {
    const q = questions[0] as { question?: unknown };
    return typeof q.question === "string" ? q.question : "";
  }
  // Fallback: some callers may pass a flat `question` field.
  const flat = (input as { question?: unknown }).question;
  return typeof flat === "string" ? flat : "";
}

/**
 * The questions asked after the first call to `tool`.
 *
 * @returns `null` when `tool` was never called, so there is no "after" to judge.
 */
export function questionsAfterFirstCall(
  tool: string,
  mcpCalls: MockCall[],
  askQuestions: AskQuestionRecord[],
): AskQuestionRecord[] | null {
  const firstCall = mcpCalls.find((c) => c.tool === tool);
  if (!firstCall) return null;
  return askQuestions.filter((asked) => asked.sequence > firstCall.sequence);
}

export function verdict(
  scenario: Scenario,
  mcpCalls: MockCall[],
  askQuestions: AskQuestionRecord[],
  gateQuestionFired: boolean,
): RunVerdict {
  const reasons: string[] = [];

  if (scenario.expect.askQuestionForGate && !gateQuestionFired) {
    reasons.push(
      `expected gate to ask Picker 1 (substring="${scenario.expect.gateQuestionSubstring}") but it never fired`,
    );
  }
  if (!scenario.expect.askQuestionForGate && gateQuestionFired) {
    reasons.push(
      `expected gate to be silent but Picker 1 fired (substring matched: "${scenario.expect.gateQuestionSubstring}")`,
    );
  }

  if (scenario.expect.executeTool) {
    const exec = mcpCalls.find((c) => c.tool === scenario.expect.executeTool);
    if (!exec) {
      reasons.push(`expected ${scenario.expect.executeTool} to be called but it was not`);
    } else if (scenario.expect.executeArgs) {
      const args = (exec.args ?? {}) as Record<string, unknown>;
      for (const [k, expected] of Object.entries(scenario.expect.executeArgs)) {
        const actualPresent = Object.prototype.hasOwnProperty.call(args, k);
        if (Array.isArray(expected)) {
          // Set of acceptable outcomes — for gates where more than one arg shape
          // is behaviorally correct (e.g. showElectronBrowser=always is satisfied
          // by omitting showUi OR passing showUi:true; only showUi:false is wrong).
          // The literal "OMITTED" element means "absent is acceptable".
          const allowAbsent = expected.includes("OMITTED");
          const allowedValues = expected.filter((v) => v !== "OMITTED");
          const ok = actualPresent
            ? allowedValues.some((v) => v === args[k])
            : allowAbsent;
          if (!ok) {
            const got = actualPresent ? JSON.stringify(args[k]) : "<omitted>";
            reasons.push(`expected ${k} to be one of ${JSON.stringify(expected)} on ${exec.tool} but got ${got}`);
          }
        } else if (expected === "OMITTED") {
          if (actualPresent) {
            reasons.push(`expected ${k} to be omitted from ${exec.tool} but it was ${JSON.stringify(args[k])}`);
          }
        } else {
          if (!actualPresent) {
            reasons.push(`expected ${k}=${JSON.stringify(expected)} on ${exec.tool} but it was omitted`);
          } else if (args[k] !== expected) {
            reasons.push(`expected ${k}=${JSON.stringify(expected)} on ${exec.tool} but got ${JSON.stringify(args[k])}`);
          }
        }
      }
    }
  }

  const silentAfterTool = scenario.expect.noQuestionAfterTool;
  if (silentAfterTool) {
    const lateQuestions = questionsAfterFirstCall(silentAfterTool, mcpCalls, askQuestions);
    if (lateQuestions === null) {
      reasons.push(`expected ${silentAfterTool} to be called but it was not`);
    } else if (lateQuestions.length > 0) {
      const asked = lateQuestions.map((q) => JSON.stringify(q.question)).join(", ");
      reasons.push(`expected no question after ${silentAfterTool} but the run asked ${asked}`);
    }
  }

  const askingAfterTool = scenario.expect.questionAfterTool;
  if (askingAfterTool) {
    const lateQuestions = questionsAfterFirstCall(askingAfterTool, mcpCalls, askQuestions);
    if (lateQuestions === null) {
      reasons.push(`expected ${askingAfterTool} to be called but it was not`);
    } else if (lateQuestions.length === 0) {
      reasons.push(`expected a question after ${askingAfterTool} but the run asked none`);
    }
  }

  const upFrontQuestion = scenario.expect.questionBeforeTool;
  if (upFrontQuestion) {
    const firstCall = mcpCalls.find((c) => c.tool === upFrontQuestion.tool);
    if (!firstCall) {
      reasons.push(`expected ${upFrontQuestion.tool} to be called but it was not`);
    } else {
      const isAskedBefore = askQuestions.some(
        (asked) => asked.question.includes(upFrontQuestion.questionContains) && asked.sequence < firstCall.sequence,
      );
      if (!isAskedBefore) {
        reasons.push(`expected a question containing "${upFrontQuestion.questionContains}" before ${upFrontQuestion.tool} but none was asked`);
      }
    }
  }

  return {
    scenario: scenario.name,
    pass: reasons.length === 0,
    reasons: reasons,
    trace: {
      mcpCalls: mcpCalls,
      askQuestions: askQuestions,
    },
  };
}
