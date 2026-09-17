/**
 * Init command — the first-run walkthrough that explains Muggle Test and
 * writes the user's preferences.
 *
 * Three modes share one engine: an interactive terminal wizard, a JSON emit for
 * an agent front-end to render as native pickers, and an apply step that persists
 * answers from either surface in a single write.
 */

import { readFileSync } from "fs";

import {
  OnboardingBlanketChoice,
  PreferenceKey,
  applyOnboardingAnswers,
  buildOnboardingPlan,
  needsOnboarding,
  type IOnboardingAnswers,
  type IOnboardingApplyResult,
} from "../../../packages/mcps/src/index.js";

import { runTerminalWalkthrough } from "./init-terminal-wizard.js";
import type { IInitOptions } from "./init-types.js";

function isBlanketChoice(value: unknown): value is OnboardingBlanketChoice {
  return Object.values(OnboardingBlanketChoice).includes(value as OnboardingBlanketChoice);
}

/**
 * Parse and validate an answers file.
 *
 * @throws When the file is not JSON, names an unknown disposition, or names an unknown key.
 */
function parseAnswersFile(filePath: string): IOnboardingAnswers {
  const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<IOnboardingAnswers>;

  if (!isBlanketChoice(parsed.blanket)) {
    throw new Error(
      `Answers file must set "blanket" to one of: ${Object.values(OnboardingBlanketChoice).join(", ")}`,
    );
  }

  const validKeys = Object.values(PreferenceKey) as string[];
  for (const key of parsed.selectedToggleKeys ?? []) {
    if (!validKeys.includes(key)) {
      throw new Error(`Unknown preference key in selectedToggleKeys: ${key}`);
    }
  }

  return {
    blanket: parsed.blanket,
    selectedToggleKeys: parsed.selectedToggleKeys,
    choices: parsed.choices,
  };
}

function reportOutcome(result: IOnboardingApplyResult): void {
  if (result.skip && !result.skip.isRetired) {
    console.log("Skipped. Muggle will offer this again next session.");
    return;
  }

  if (result.skip) {
    console.log("Skipped. Muggle will not ask again — run `muggle init` whenever you want it.");
    return;
  }

  const summary = Object.entries(result.preferences)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.log("");
  console.log("Preferences saved.");
  console.log(summary);
  // A pointer, not an automatic write: this walkthrough saves preferences under
  // the user's home, and putting a file inside their repository is a different
  // act that deserves its own explicit command.
  console.log("");
  console.log(
    "To make pull requests here carry a Muggle walkthrough comment even when they're opened outside Claude, run `muggle ci-install`.",
  );
}

/**
 * Execute the init command.
 * @param options - Command options.
 */
export async function initCommand(options: IInitOptions): Promise<void> {
  if (options.json) {
    console.log(JSON.stringify(buildOnboardingPlan(), null, 2));
    return;
  }

  if (options.apply) {
    try {
      reportOutcome(applyOnboardingAnswers(parseAnswersFile(options.apply)));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (!process.stdin.isTTY) {
    console.error(
      "`muggle init` needs an interactive terminal. Use `--json` to render the walkthrough elsewhere and `--apply <file>` to save the answers.",
    );
    process.exitCode = 1;
    return;
  }

  if (!needsOnboarding()) {
    console.log("Muggle is already set up. Re-running the walkthrough — your current values are pre-selected.");
  }

  reportOutcome(applyOnboardingAnswers(await runTerminalWalkthrough()));
}
