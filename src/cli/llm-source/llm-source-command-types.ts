/**
 * Type definitions for the `muggle llm-source` command.
 */

/**
 * Options for the llm-source command.
 */
export interface ILlmSourceCommandOptions {
  /** Print the source in effect and exit. */
  show?: boolean;
  /** Emit the question as JSON for an agent front-end to render. */
  json?: boolean;
  /** Apply a source without the interactive question. */
  use?: string;
  /** Endpoint URL, with `--use local-model`. */
  baseUrl?: string;
  /** Model name served at the endpoint, with `--use local-model`. */
  model?: string;
}

/** Prints one line of output. */
export type PrintLine = (line: string) => void;

/**
 * Terminal prompts the LLM-source question needs.
 */
export interface ILlmSourcePrompter {
  /** Ask a question and resolve to the typed answer. */
  ask: (question: string) => Promise<string>;
  /** Ask a question without echoing what is typed. */
  askHidden: (question: string) => Promise<string>;
}

/**
 * A prompter bound to the process terminal, which must be closed after use.
 */
export interface ITerminalLlmSourcePrompter extends ILlmSourcePrompter {
  /** Release the terminal. */
  close: () => void;
}
