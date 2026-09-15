/**
 * Terminal rendering for the first-run walkthrough.
 *
 * Presentation only: every mapping from a selection onto a preference value lives in
 * the onboarding service, so this surface and the agent surface cannot drift apart.
 */

import { createInterface, type Interface } from "node:readline/promises";

import {
  OnboardingBlanketChoice,
  OnboardingGroupKind,
  PreferenceKey,
  PreferenceValue,
  buildOnboardingPlan,
  type IOnboardingAnswers,
  type IOnboardingChoiceGroup,
  type IOnboardingToggleGroup,
} from "../../../packages/mcps/src/index.js";

/** Prompt shown when a question accepts its pre-selected answer on Enter. */
const ACCEPT_HINT = "press Enter to accept";

function printPrimer(): void {
  const plan = buildOnboardingPlan();
  console.log("");
  console.log(plan.primerHeadline);
  console.log("");
  for (const bullet of plan.primerBullets) {
    console.log(`  - ${bullet}`);
  }
  console.log("");
}

/**
 * Read a 1-based option number, falling back to a default on empty input.
 */
async function askOptionNumber(
  rl: Interface,
  optionCount: number,
  defaultIndex: number,
): Promise<number> {
  for (;;) {
    const answer = (await rl.question(`Choose 1-${optionCount} (${ACCEPT_HINT}): `)).trim();
    if (answer.length === 0) {
      return defaultIndex;
    }
    const picked = Number.parseInt(answer, 10);
    if (Number.isInteger(picked) && picked >= 1 && picked <= optionCount) {
      return picked - 1;
    }
    console.log(`Enter a number between 1 and ${optionCount}.`);
  }
}

async function askBlanketChoice(rl: Interface): Promise<OnboardingBlanketChoice> {
  const options = buildOnboardingPlan().blanketOptions;
  options.forEach((option, index) => {
    console.log(`  ${index + 1}. ${option.label}`);
    console.log(`     ${option.description}`);
  });
  console.log("");
  const picked = await askOptionNumber(rl, options.length, 0);
  return options[picked].choice;
}

async function askToggleGroup(
  rl: Interface,
  group: IOnboardingToggleGroup,
  selected: Set<PreferenceKey>,
): Promise<void> {
  console.log("");
  console.log(`- ${group.header} -`);
  console.log(group.prompt);
  group.entries.forEach((entry, index) => {
    if (entry.isSelectedByDefault) {
      selected.add(entry.key);
    }
    const mark = entry.isSelectedByDefault ? "x" : " ";
    console.log(`  [${mark}] ${index + 1}. ${entry.key} — ${entry.description}`);
  });

  const answer = (
    await rl.question(`Numbers to flip, comma-separated (${ACCEPT_HINT}): `)
  ).trim();
  if (answer.length === 0) {
    return;
  }

  for (const token of answer.split(",")) {
    const picked = Number.parseInt(token.trim(), 10);
    if (!Number.isInteger(picked) || picked < 1 || picked > group.entries.length) {
      continue;
    }
    const { key } = group.entries[picked - 1];
    if (selected.has(key)) {
      selected.delete(key);
    } else {
      selected.add(key);
    }
  }
}

async function askChoiceGroup(
  rl: Interface,
  group: IOnboardingChoiceGroup,
  choices: Partial<Record<PreferenceKey, PreferenceValue>>,
): Promise<void> {
  console.log("");
  console.log(`- ${group.header} -`);
  console.log(group.prompt);
  const defaultIndex = Math.max(
    group.options.findIndex((option) => option.isDefault),
    0,
  );
  group.options.forEach((option, index) => {
    const mark = option.isDefault ? "*" : " ";
    console.log(`  ${mark} ${index + 1}. ${option.label}`);
  });

  const picked = await askOptionNumber(rl, group.options.length, defaultIndex);
  choices[group.key] = group.options[picked].value;
}

/**
 * Run the walkthrough against the terminal and return what the user picked.
 *
 * @returns The user's raw answers, for the onboarding service to resolve and persist.
 */
export async function runTerminalWalkthrough(): Promise<IOnboardingAnswers> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    printPrimer();
    const blanket = await askBlanketChoice(rl);

    if (blanket !== OnboardingBlanketChoice.Customize) {
      return { blanket: blanket };
    }

    const selected = new Set<PreferenceKey>();
    const choices: Partial<Record<PreferenceKey, PreferenceValue>> = {};

    for (const group of buildOnboardingPlan().groups) {
      if (group.kind === OnboardingGroupKind.Toggle) {
        await askToggleGroup(rl, group, selected);
      } else {
        await askChoiceGroup(rl, group, choices);
      }
    }

    return {
      blanket: blanket,
      selectedToggleKeys: [...selected],
      choices: choices,
    };
  } finally {
    rl.close();
  }
}
