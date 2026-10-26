/**
 * `muggle llm-source` — show or change who supplies the model for tests Studio runs on this computer.
 */

import {
  LlmSource,
  applyLlmSourceSelection,
  buildLlmSourcePlan,
  describeLlmSourceStatus,
  resolveLlmSourceStatus,
} from "../../../packages/mcps/src/index.js";

import type { ILlmSourceCommandOptions } from "./llm-source-command-types.js";
import {
  askAnthropicApiKeySelection,
  createTerminalPrompter,
  runLlmSourceStep,
} from "./llm-source-terminal-step.js";

function parseLlmSource(rawSource: string): LlmSource | undefined {
  return Object.values(LlmSource).find((source) => source === rawSource);
}

async function applyAnthropicKeyFromTerminal(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error(
      "An API key is only accepted at a hidden terminal prompt — never as an argument. Run `muggle llm-source` in a terminal.",
    );
    process.exitCode = 1;
    return;
  }

  const prompter = createTerminalPrompter();
  try {
    const selection = await askAnthropicApiKeySelection(prompter);
    if (!selection) {
      console.log(`Cancelled. ${describeLlmSourceStatus(resolveLlmSourceStatus())}`);
      return;
    }
    console.log(`Saved. ${describeLlmSourceStatus(applyLlmSourceSelection(selection))}`);
  } finally {
    prompter.close();
  }
}

async function applySourceFromFlags(options: ILlmSourceCommandOptions): Promise<void> {
  const source = parseLlmSource(options.use ?? "");
  if (!source) {
    console.error(`--use must be one of: ${Object.values(LlmSource).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  if (source === LlmSource.AnthropicApiKey) {
    await applyAnthropicKeyFromTerminal();
    return;
  }

  try {
    const status = applyLlmSourceSelection({
      source: source,
      localBaseUrl: options.baseUrl,
      localModel: options.model,
    });
    console.log(`Saved. ${describeLlmSourceStatus(status)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

/**
 * Execute the llm-source command.
 * @param options - Command options.
 */
export async function llmSourceCommand(options: ILlmSourceCommandOptions): Promise<void> {
  if (options.json) {
    console.log(JSON.stringify(buildLlmSourcePlan(), null, 2));
    return;
  }

  if (options.show) {
    console.log(describeLlmSourceStatus(resolveLlmSourceStatus()));
    return;
  }

  if (options.use) {
    await applySourceFromFlags(options);
    return;
  }

  if (!process.stdin.isTTY) {
    console.error(
      "`muggle llm-source` needs an interactive terminal. Use `--show` to see the current source, or `--use muggle-credit` / `--use local-model --base-url <url> --model <name>` to set one.",
    );
    process.exitCode = 1;
    return;
  }

  await runLlmSourceStep();
}
