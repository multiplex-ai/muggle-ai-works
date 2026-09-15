/**
 * Type definitions for the `muggle init` command.
 */

/**
 * Options for the init command.
 */
export interface IInitOptions {
  /** Emit the walkthrough as JSON for another front-end to render. */
  json?: boolean;
  /** Path to a JSON file holding the user's answers. */
  apply?: string;
}
