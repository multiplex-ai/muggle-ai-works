/**
 * What a gate prompt is built from, whichever host runs it: the skill's
 * SKILL.md, the gate contracts (the gate under test, and every other gate the
 * scenario sets to `ask`), and the scenario's synthesized SessionStart context.
 * Nothing else can reach a prompt — the scope rule in
 * scripts/skill-eval-scope.sh depends on it, and test/system-prompt.test.ts
 * holds both hosts to it.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { PreferenceValue } from "./types.js";
import type { GatePromptInputs, RunOptions } from "./types.js";

/**
 * Read one scenario's prompt inputs.
 *
 * Output shape: `{ skillBody: "<SKILL.md>", gateBody: "<gate contract>",
 * askGateBodies: ["<openTestResultsAfterRun contract>"],
 * prefs: "showElectronBrowser=ask autoLogin=always", extraContext: "Muggle Test Last Host: …" }`
 */
export function readGatePromptInputs(
  opts: Pick<RunOptions, "skillsDir" | "scenarioFile" | "scenario">,
): GatePromptInputs {
  const skillMdPath = path.join(
    opts.skillsDir,
    opts.scenarioFile.skill,
    "SKILL.md",
  );
  const skillBody = fs.readFileSync(skillMdPath, "utf8");
  // Neither harness lets the skill open files, so a skill that says "run
  // Picker 1 from preference-gates/<gate>.md" can't open that file the way it
  // would in production. Inline the gate-under-test's contract so the model
  // has its Picker 1 question verbatim — mirroring production's Read access.
  const gatePath = gateContractPath(opts.skillsDir, opts.scenarioFile.gate);
  const gateBody = fs.existsSync(gatePath)
    ? fs.readFileSync(gatePath, "utf8")
    : "";
  // Every other gate the scenario sets to `ask` fires its Picker 1 too, from a
  // file production opens and the eval cannot. Without its question text the
  // model paraphrases, and the scenario's scripted answer no longer matches.
  const askGateBodies = Object.entries(opts.scenario.preferences)
    .filter(([preference, value]) => value === PreferenceValue.Ask && preference !== opts.scenarioFile.gate)
    .map(([preference]) => gateContractPath(opts.skillsDir, preference))
    .filter((contractPath) => fs.existsSync(contractPath))
    .map((contractPath) => fs.readFileSync(contractPath, "utf8"));
  const prefs = Object.entries(opts.scenario.preferences)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const extraContext = (opts.scenario.sessionContext ?? []).join("\n");
  return {
    skillBody: skillBody,
    gateBody: gateBody,
    askGateBodies: askGateBodies,
    prefs: prefs,
    extraContext: extraContext,
  };
}

function gateContractPath(skillsDir: string, gate: string): string {
  return path.join(skillsDir, "muggle-preferences", "preference-gates", `${gate}.md`);
}

/**
 * The prompt section carrying the other `ask` gates' contracts, or "" when the
 * scenario sets none to `ask`.
 */
export function askGateContractsSection(askGateBodies: string[]): string {
  if (askGateBodies.length === 0) return "";
  return [
    "",
    "---",
    "# Other preference gates set to `ask` this run",
    "When one of these fires, ask its Picker 1 question using the question text verbatim.",
    "",
    ...askGateBodies,
  ].join("\n");
}
