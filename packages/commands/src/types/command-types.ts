import type { Command } from "commander";

/**
 * Options used when configuring the CLI program shell.
 */
export interface ICliProgramOptions {
  /**
   * Resolved CLI package version.
   */
  packageVersion: string;
}

/**
 * Shared command registration context.
 */
export interface ICommandRegistrationContext {
  /**
   * Commander program instance to mutate.
   */
  program: Command;
}
