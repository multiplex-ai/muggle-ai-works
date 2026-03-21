import type { ICommandRegistrationContext } from "../types/command-types.js";

/**
 * Register all core commands on the provided CLI program.
 *
 * This function intentionally does not bind command handlers yet; it provides
 * a single composition point that the root CLI can call while command modules
 * are migrated into this package incrementally.
 *
 * @param commandRegistrationContext - Program registration context.
 */
export function registerCoreCommands (
  commandRegistrationContext: ICommandRegistrationContext,
): void {
  void commandRegistrationContext;
}
