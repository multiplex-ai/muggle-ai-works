/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins muggle-do's post-merge stage (`do/cleanup.md`) to reading the session
 * slot only while it exists. Teardown deletes `~/.muggle-ai/muggle-do/sessions/<slug>/`,
 * yet the stage used to log into that slot afterwards and hand `next-step.md`
 * a slug whose `prs.json`, `result.md` and `followup.log` were already gone.
 * The stage now captures a terminal record before teardown, passes it on, and
 * logs only into a slot teardown left in place.
 *
 * Each finished PR's record also lands in the chat's ledger outside the
 * sessions directory, so a PR this chat finished earlier — whose slot is long
 * gone — still reaches next-step's status block.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { sectionBody } from "./helpers/markdown-sections";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DO_DIR = path.resolve(__dirname, "../../../plugin/skills/do");

const CLEANUP = fs.readFileSync(path.join(DO_DIR, "cleanup.md"), "utf8");
const TERMINAL_RECORD = sectionBody(CLEANUP, /^## Terminal record$/m);
const CHAT_LEDGER = sectionBody(CLEANUP, /^## Chat ledger$/m);
const PROCEDURE = sectionBody(CLEANUP, /^## Procedure$/m);

const RETIRE_STEP = /^(\d+)\. \*\*Retire the cases.*$/m;
const CAPTURE_STEP = /^(\d+)\. \*\*Capture the \[terminal record\]\(#terminal-record\)\*\*.*$/m;
const TEARDOWN_STEP = /^(\d+)\. \*\*Teardown \(`merged` only\)\.\*\*.*$/m;
const LEDGER_STEP = /^(\d+)\. \*\*Record the PR in the \[chat ledger\]\(#chat-ledger\)\.\*\*.*$/m;
const LOG_STEP = /^(\d+)\. \*\*Log while the slot exists\.\*\*.*$/m;
const NEXT_STEP_STEP = /^(\d+)\. Suggest the next step per \[`next-step\.md`\]\(next-step\.md\).*$/m;

const RECORD_FIELDS = ["pr", "state", "title", "e2eFailing", "escalatedReviewIds", "waivers", "teardown", "finishedAt"];

/** The step's number and full line, or `undefined` when no procedure step matches. */
function findStep(stepPattern: RegExp): { stepNumber: number; line: string } | undefined {
  const match = PROCEDURE.match(stepPattern);
  return match ? { stepNumber: Number(match[1]), line: match[0] } : undefined;
}

describe("parser sanity: refuse to pass vacuously", () => {
  it("finds every section and step under test", () => {
    expect(TERMINAL_RECORD.length, "## Terminal record not found or empty").toBeGreaterThan(100);
    expect(CHAT_LEDGER.length, "## Chat ledger not found or empty").toBeGreaterThan(100);
    expect(PROCEDURE.length, "## Procedure not found or empty").toBeGreaterThan(100);
    for (const [name, stepPattern] of Object.entries({
      retire: RETIRE_STEP,
      capture: CAPTURE_STEP,
      teardown: TEARDOWN_STEP,
      ledger: LEDGER_STEP,
      log: LOG_STEP,
      nextStep: NEXT_STEP_STEP,
    })) {
      expect(findStep(stepPattern), `step not found: ${name}`).toBeDefined();
    }
  });
});

describe("do/cleanup.md — terminal record", () => {
  it("defines every field next-step reports the terminal slug from", () => {
    const definedFields = [...TERMINAL_RECORD.matchAll(/^- `(\w+)` — /gm)].map((match) => match[1]);
    expect(definedFields).toEqual(RECORD_FIELDS);
  });

  it("names where each fact comes from", () => {
    expect(TERMINAL_RECORD).toMatch(/^- `pr` — .*from `prs\.json`/m);
    expect(TERMINAL_RECORD).toMatch(/^- `title` — .*PR-metadata recipe/m);
    expect(TERMINAL_RECORD).toMatch(/^- `e2eFailing` — .*`\[E2E FAILING\]`/m);
    expect(TERMINAL_RECORD).toMatch(/^- `escalatedReviewIds` — `result\.md`'s `Escalated review ids`/m);
    expect(TERMINAL_RECORD).toMatch(/^- `waivers` — `state\.md`'s waiver and Blocker lines/m);
    expect(TERMINAL_RECORD).toMatch(/^- `teardown` — .*this turn's teardown report: `cleaned up` when no row is `❌`.*`branch kept` when teardown did not run/m);
    expect(TERMINAL_RECORD).toMatch(/^- `finishedAt` — ISO-8601/m);
  });
});

describe("do/cleanup.md — chat ledger", () => {
  it("keeps the ledger outside the sessions directory, so teardown never deletes it", () => {
    expect(CHAT_LEDGER).toMatch(/^`~\/\.muggle-ai\/muggle-do\/chats\/<session-id>\.json`/m);
    expect(CHAT_LEDGER).toMatch(/outside the sessions directory, so teardown never deletes it/);
  });

  it("names the ledger by the running session id, and writes none without one", () => {
    expect(CHAT_LEDGER).toMatch(/`<session-id>` is `\$CLAUDE_CODE_SESSION_ID`; unset, the chat cannot name its ledger and none is written/);
  });

  it("rewrites the whole file and replaces a PR's earlier entry", () => {
    expect(CHAT_LEDGER).toMatch(/Rewrite the whole file per \[`session-state-writes\.md`\]/);
    expect(CHAT_LEDGER).toMatch(/a record whose `pr` is already listed replaces that entry/);
  });

  it("completes the record after teardown and writes it whether or not the slot survived", () => {
    const ledgerLine = findStep(LEDGER_STEP)?.line ?? "";
    expect(ledgerLine).toMatch(/Complete the terminal record with `teardown` and `finishedAt`, then write it to the ledger/);
    expect(ledgerLine).toMatch(/whether or not teardown cleared it/);
  });
});

describe("do/cleanup.md — nothing touches the slot after teardown", () => {
  it("orders retire → capture → teardown → ledger → log → next step", () => {
    const stepNumbers = [RETIRE_STEP, CAPTURE_STEP, TEARDOWN_STEP, LEDGER_STEP, LOG_STEP, NEXT_STEP_STEP].map(
      (stepPattern) => findStep(stepPattern)?.stepNumber ?? -1,
    );
    expect(stepNumbers).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it("makes the capture the last read of the slot", () => {
    expect(findStep(CAPTURE_STEP)?.line).toMatch(/last read of `<slug>`'s slot/);
  });

  it("writes no log line into a slot teardown cleared", () => {
    const logLine = findStep(LOG_STEP)?.line ?? "";
    expect(logLine).toMatch(/report marks `Session slot cleared` ✅, write nothing/);
    expect(logLine).toMatch(/Otherwise append a cleanup line to the session's `followup\.log`/);
  });

  it("hands the terminal record to next-step", () => {
    expect(findStep(NEXT_STEP_STEP)?.line).toMatch(/passing whether teardown ran and the terminal record/);
  });

  it("guarantees the steps after teardown by their current numbers", () => {
    const ledgerStep = findStep(LEDGER_STEP)?.stepNumber;
    const logStep = findStep(LOG_STEP)?.stepNumber;
    const nextStep = findStep(NEXT_STEP_STEP)?.stepNumber;
    expect(CLEANUP).toContain(`so steps ${ledgerStep}, ${logStep} and ${nextStep} always run`);
  });
});
