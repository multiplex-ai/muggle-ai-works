/**
 * Commands package public surface.
 */

export type { ICliProgramOptions, ICommandRegistrationContext } from "./types/command-types.js";
export { runCli } from "./cli/run-cli.js";
export {
  cleanupCommand,
  doctorCommand,
  helpCommand,
  loginCommand,
  logoutCommand,
  serveCommand,
  setupCommand,
  statusCommand,
  upgradeCommand,
  versionsCommand,
} from "./handlers/index.js";
export { registerCoreCommands } from "./registry/register-core-commands.js";
/**
 * Commands package domain placeholder.
 */
export {};
