/**
 * Terminal rendering for the LLM-source question.
 *
 * Presentation only: validation, storage, and status wording live in the LLM source service,
 * so this surface and the agent surface cannot drift apart.
 */

import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

import {
  DEFAULT_LOCAL_LLM_BASE_URL,
  LlmSource,
  applyLlmSourceSelection,
  buildLlmSourcePlan,
  describeLlmSourceStatus,
  isValidLocalBaseUrl,
  resolveLlmSourceStatus,
  type ILlmSourcePlan,
  type ILlmSourceSelection,
  type ILlmSourceStatus,
} from "../../../packages/mcps/src/index.js";

import type {
  ILlmSourcePrompter,
  ITerminalLlmSourcePrompter,
  PrintLine,
} from "./llm-source-command-types.js";

/**
 * Bind a prompter to the process terminal. Hidden questions mute readline's echo, so a pasted
 * key never reaches the screen or the scrollback.
 */
export function createTerminalPrompter(): ITerminalLlmSourcePrompter {
  let isEchoMuted = false;
  const echoControlledOutput = new Writable({
    write(chunk, encoding, callback) {
      if (!isEchoMuted) {
        process.stdout.write(chunk, encoding);
      }
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output: echoControlledOutput, terminal: true });

  return {
    ask: (question) => rl.question(question),
    askHidden: async (question) => {
      process.stdout.write(question);
      isEchoMuted = true;
      try {
        return await rl.question("");
      } finally {
        isEchoMuted = false;
        process.stdout.write("\n");
      }
    },
    close: () => rl.close(),
  };
}

/**
 * Ask for an Anthropic key at a hidden prompt.
 * @returns The selection, or undefined when the user cancels with an empty answer.
 */
export async function askAnthropicApiKeySelection(
  prompter: ILlmSourcePrompter,
): Promise<ILlmSourceSelection | undefined> {
  const apiKey = (await prompter.askHidden("Anthropic API key (input hidden; Enter to cancel): ")).trim();
  if (!apiKey) {
    return undefined;
  }
  return { source: LlmSource.AnthropicApiKey, apiKey: apiKey };
}

async function askLocalModelSelection(
  prompter: ILlmSourcePrompter,
  current: ILlmSourceStatus,
  print: PrintLine,
): Promise<ILlmSourceSelection> {
  const defaultBaseUrl = current.localBaseUrl ?? DEFAULT_LOCAL_LLM_BASE_URL;
  let localBaseUrl = "";
  while (!isValidLocalBaseUrl(localBaseUrl)) {
    localBaseUrl = (await prompter.ask(`Endpoint URL [${defaultBaseUrl}]: `)).trim() || defaultBaseUrl;
    if (!isValidLocalBaseUrl(localBaseUrl)) {
      print(`Enter an http(s) URL, e.g. ${DEFAULT_LOCAL_LLM_BASE_URL}`);
    }
  }

  const modelHint = current.localModel ? ` [${current.localModel}]` : "";
  let localModel = "";
  while (!localModel) {
    localModel = (await prompter.ask(`Vision-capable model name${modelHint}: `)).trim() || (current.localModel ?? "");
    if (!localModel) {
      print("Enter the model name the endpoint serves, e.g. qwen2.5vl.");
    }
  }

  const apiKey = (
    await prompter.askHidden("Endpoint API key, if it needs one (input hidden; Enter for none): ")
  ).trim();
  return {
    source: LlmSource.LocalModel,
    localBaseUrl: localBaseUrl,
    localModel: localModel,
    apiKey: apiKey || undefined,
  };
}

async function askSourceIndex(prompter: ILlmSourcePrompter, optionCount: number, print: PrintLine) {
  for (;;) {
    const answer = (await prompter.ask(`Choose 1-${optionCount} (press Enter to keep the current source): `)).trim();
    if (answer.length === 0) {
      return undefined;
    }
    const picked = Number.parseInt(answer, 10);
    if (Number.isInteger(picked) && picked >= 1 && picked <= optionCount) {
      return picked - 1;
    }
    print(`Enter a number between 1 and ${optionCount}.`);
  }
}

/**
 * Ask which source should supply the model for local runs.
 * @param prompter - Terminal prompts.
 * @param plan - The question, with the source currently in effect.
 * @param print - Output sink; defaults to the console.
 * @returns The selection, or undefined to keep the current source.
 */
export async function askLlmSourceSelection(
  prompter: ILlmSourcePrompter,
  plan: ILlmSourcePlan,
  print: PrintLine = (line) => console.log(line),
): Promise<ILlmSourceSelection | undefined> {
  print("");
  print(`- ${plan.header} -`);
  print(plan.prompt);
  print(plan.scopeNote);
  plan.options.forEach((option, index) => {
    const mark = option.source === plan.current.source ? "*" : " ";
    print(`  ${mark} ${index + 1}. ${option.label}`);
    print(`       ${option.description}`);
  });
  print(`Current — ${describeLlmSourceStatus(plan.current)}`);

  const pickedIndex = await askSourceIndex(prompter, plan.options.length, print);
  if (pickedIndex === undefined) {
    return undefined;
  }

  const source = plan.options[pickedIndex].source;
  if (source === LlmSource.MuggleCredit) {
    return { source: source };
  }
  if (source === LlmSource.AnthropicApiKey) {
    return askAnthropicApiKeySelection(prompter);
  }
  return askLocalModelSelection(prompter, plan.current, print);
}

/**
 * Ask for the LLM source in the terminal and save the answer.
 */
export async function runLlmSourceStep(): Promise<void> {
  const prompter = createTerminalPrompter();
  try {
    const selection = await askLlmSourceSelection(prompter, buildLlmSourcePlan());
    if (!selection) {
      console.log(`Kept. ${describeLlmSourceStatus(resolveLlmSourceStatus())}`);
      return;
    }
    console.log(`Saved. ${describeLlmSourceStatus(applyLlmSourceSelection(selection))}`);
  } finally {
    prompter.close();
  }
}
