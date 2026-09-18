/**
 * Init command — the first-run walkthrough that explains Muggle Test and
 * writes the user's preferences.
 *
 * Three modes share one engine: an interactive terminal wizard, a JSON emit for
 * an agent front-end to render as native pickers, and an apply step that persists
 * answers from either surface in a single write.
 */

import { readFileSync } from "fs";
import { createInterface } from "node:readline/promises";

import {
  OnboardingBlanketChoice,
  PreferenceKey,
  applyOnboardingAnswers,
  buildOnboardingPlan,
  needsOnboarding,
  type IOnboardingAnswers,
  type IOnboardingApplyResult,
} from "../../../packages/mcps/src/index.js";

import { USER_WORKFLOW_PATH } from "../../ci-workflow/constants.js";
import { offerCiWorkflow } from "./ci-question.js";
import { CiOfferOutcome } from "./ci-question-types.js";
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
}

const CI_OFFER_REPORT: Record<CiOfferOutcome, string | null> = {
  [CiOfferOutcome.Installed]: `Added ${USER_WORKFLOW_PATH} — commit it, and every pull request here will owe a settled walkthrough comment.`,
  [CiOfferOutcome.Declined]: "Left CI alone. Run `muggle ci-install` whenever you want it.",
  [CiOfferOutcome.AlreadyInstalled]: null,
  [CiOfferOutcome.NotApplicable]: null,
};

/** Ask the CI question at the end of the walkthrough, and report what it did. */
async function runCiOffer(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const line = CI_OFFER_REPORT[await offerCiWorkflow((q) => rl.question(q), process.cwd())];
    if (line) {
      console.log("");
      console.log(line);
    }
  } finally {
    rl.close();
  }
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
  await runCiOffer();
}
