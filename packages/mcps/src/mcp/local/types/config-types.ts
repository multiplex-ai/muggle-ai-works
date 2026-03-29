/**
 * Config types for local QA module.
 */

import type { IAuth0Config } from "./auth-types.js";

/**
 * Local QA configuration.
 */
export interface ILocalQaConfig {
  /** Base data directory (~/.muggle-ai). */
  dataDir: string;
  /** Sessions directory. */
  sessionsDir: string;
  /** Projects directory. */
  projectsDir: string;
  /** Temp directory. */
  tempDir: string;
  /** OAuth session file path (OAuth tokens with refresh). */
  oauthSessionFilePath: string;
  /** Electron app path. */
  electronAppPath?: string;
  /** Web service URL. */
  webServiceUrl: string;
  /** Prompt service URL. */
  promptServiceUrl: string;
  /** Auth0 configuration. */
  auth0: IAuth0Config;
}
