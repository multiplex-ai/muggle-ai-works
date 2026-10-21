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
 * Decide whether an AskQuestion call relates to the gate under test.
 * The simplest signal is `gateQuestionSubstring` — when present, an
 * AskQuestion whose text contains the substring is "the gate firing".
 */
export function isGateQuestion(question: string, scenario: Scenario): boolean {
  const sub = scenario.expect.gateQuestionSubstring;
  if (!sub) return false;
  return question.includes(sub);
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
