/**
 * What a gate prompt is built from, whichever host runs it: the skill's
 * SKILL.md, the contract of the gate under test, and the scenario's synthesized
 * SessionStart context. Nothing else can reach a prompt — the scope rule in
 * scripts/skill-eval-scope.sh depends on it, and test/system-prompt.test.ts
 * holds both hosts to it.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { GatePromptInputs, RunOptions } from "./types.js";

/**
 * Read one scenario's prompt inputs.
 *
 * Output shape: `{ skillBody: "<SKILL.md>", gateBody: "<gate contract>",
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
  const gatePath = path.join(
    opts.skillsDir,
    "muggle-preferences",
    "preference-gates",
    `${opts.scenarioFile.gate}.md`,
  );
  const gateBody = fs.existsSync(gatePath)
    ? fs.readFileSync(gatePath, "utf8")
    : "";
  const prefs = Object.entries(opts.scenario.preferences)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const extraContext = (opts.scenario.sessionContext ?? []).join("\n");
  return { skillBody: skillBody, gateBody: gateBody, prefs: prefs, extraContext: extraContext };
}
